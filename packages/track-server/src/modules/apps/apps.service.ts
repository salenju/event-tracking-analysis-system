import { randomBytes } from 'node:crypto';
import type { AppConfig } from '../../config/index.js';
import type { AdminUser, AnalyticsApp, UserRole, UserStatus } from '../../domain/auth.js';
import { BadRequestError, ConflictError, isDuplicateKeyError, NotFoundError } from '../../domain/errors.js';
import { AppRegistry, maskSecret } from '../../lib/app-secret.js';
import type { AdminUserStore, AppStore, AppUpdatePatch } from '../../repositories/ports.js';
import { toPublicUser, type PublicUser } from '../auth/user.dto.js';

export interface PublicApp {
  appId: string;
  name: string;
  env: string;
  status: 'active' | 'disabled';
  remark: string | null;
  source: 'db' | 'env';
  secretMask: string;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAppInput {
  name: string;
  env?: string;
  remark?: string | null;
}

export interface UpdateAppInput {
  name?: string;
  env?: string;
  status?: 'active' | 'disabled';
  remark?: string | null;
}

export interface UpdateUserInput {
  role?: UserRole;
  status?: UserStatus;
}

export interface AppsServiceDeps {
  store: AppStore | null;
  registry: AppRegistry;
  users: AdminUserStore;
  config: AppConfig;
  now?: () => Date;
}

const APP_NAME_MAX = 64;
const ENV_PATTERN = /^[a-z0-9_-]{1,16}$/;

export function toPublicApp(app: AnalyticsApp): PublicApp {
  return {
    appId: app.appId,
    name: app.name,
    env: app.env,
    status: app.status,
    remark: app.remark,
    source: app.source,
    secretMask: maskSecret(app.secret),
    createdBy: app.createdBy,
    createdAt: app.createdAt.toISOString(),
    updatedAt: app.updatedAt.toISOString(),
  };
}

function assertName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) throw new BadRequestError('应用名称不能为空');
  if (trimmed.length > APP_NAME_MAX) throw new BadRequestError(`应用名称不能超过 ${APP_NAME_MAX} 个字符`);
  return trimmed;
}

function assertEnv(env: string): string {
  const value = env.trim().toLowerCase();
  if (!ENV_PATTERN.test(value)) throw new BadRequestError('env 只能是 1-16 位小写字母、数字、下划线或中划线');
  return value;
}

export class AppsService {
  private readonly now: () => Date;

  constructor(private readonly deps: AppsServiceDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  private get store(): AppStore {
    if (!this.deps.store) throw new ConflictError('当前模式未启用应用注册表（START_MODE=ingest）');
    return this.deps.store;
  }

  async list(): Promise<PublicApp[]> {
    const apps = await this.deps.registry.listApps();
    return apps.map(toPublicApp);
  }

  async create(input: CreateAppInput, actor: AdminUser): Promise<{ app: PublicApp; secret: string }> {
    const store = this.store;
    const name = assertName(input.name);
    const env = input.env ? assertEnv(input.env) : this.deps.config.trackEnv;
    await this.assertNameAvailable(store, name, env);
    const remark = input.remark?.trim() ? input.remark.trim().slice(0, 255) : null;
    const now = this.now();
    const secret = randomBytes(24).toString('hex');

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const appId = buildAppId();
      const app: AnalyticsApp = {
        appId,
        name,
        secret,
        env,
        status: 'active',
        remark,
        createdBy: actor.openId ?? actor.localUsername ?? String(actor.id),
        createdAt: now,
        updatedAt: now,
        source: 'db',
      };
      try {
        await store.insert(app);
        this.deps.registry.invalidate(appId);
        return { app: toPublicApp(app), secret };
      } catch (error) {
        if (!isDuplicateKeyError(error)) throw error;
      }
    }
    throw new ConflictError('生成 appId 失败，请重试');
  }

  async update(appId: string, patch: UpdateAppInput): Promise<PublicApp> {
    const existing = await this.findEditable(appId);
    const normalized: AppUpdatePatch = {};
    if (patch.name !== undefined) normalized.name = assertName(patch.name);
    if (patch.env !== undefined) normalized.env = assertEnv(patch.env);
    if (patch.status !== undefined) normalized.status = patch.status;
    if (patch.remark !== undefined) normalized.remark = patch.remark?.trim() ? patch.remark.trim().slice(0, 255) : null;

    // 改名或换环境时才校验，避免改名未变也去扫表
    const nextName = normalized.name ?? existing.name;
    const nextEnv = normalized.env ?? existing.env;
    if (nextName !== existing.name || nextEnv !== existing.env) {
      await this.assertNameAvailable(this.store, nextName, nextEnv, existing.appId);
    }

    await this.store.update(existing.appId, normalized, this.now());
    // 停用后必须立刻让验签侧看到，不能等缓存过期
    this.deps.registry.invalidate(existing.appId);
    const updated = await this.store.find(existing.appId);
    if (!updated) throw new NotFoundError('应用不存在');
    return toPublicApp(updated);
  }

  async rotate(appId: string): Promise<{ app: PublicApp; secret: string }> {
    const existing = await this.findEditable(appId);
    const secret = randomBytes(24).toString('hex');
    await this.store.updateSecret(existing.appId, secret, this.now());
    this.deps.registry.invalidate(existing.appId);
    const updated = (await this.store.find(existing.appId)) ?? { ...existing, secret };
    return { app: toPublicApp(updated), secret };
  }

  async remove(appId: string): Promise<void> {
    const existing = await this.findEditable(appId);
    await this.store.remove(existing.appId);
    this.deps.registry.invalidate(existing.appId);
  }

  async listUsers(): Promise<PublicUser[]> {
    const users = await this.deps.users.list();
    return users.map(toPublicUser);
  }

  async updateUser(id: number, patch: UpdateUserInput, actor: AdminUser): Promise<PublicUser> {
    const target = await this.deps.users.findById(id);
    if (!target) throw new NotFoundError('用户不存在');
    if (patch.role === undefined && patch.status === undefined) {
      throw new BadRequestError('至少需要修改 role 或 status');
    }

    const losingAdmin = target.role === 'admin' && (patch.role === 'viewer' || patch.status === 'disabled');
    if (losingAdmin) {
      if (target.id === actor.id) throw new ConflictError('不能降级或停用自己');
      const admins = await this.deps.users.countActiveAdmins();
      if (admins <= 1) throw new ConflictError('至少要保留一个可用管理员');
    }

    if (patch.role !== undefined) await this.deps.users.updateRole(target.id, patch.role, this.now());
    if (patch.status !== undefined) await this.deps.users.updateStatus(target.id, patch.status, this.now());

    const updated = await this.deps.users.findById(target.id);
    if (!updated) throw new NotFoundError('用户不存在');
    return toPublicUser(updated);
  }

  /**
   * 同一环境下应用名唯一：一个业务按环境建多条应用是允许的，但同环境重名会让人分不清
   * 到底该把哪套 appId 配进 SDK，因此在应用层拦住（库里 name 无唯一索引，避免历史数据迁移失败）。
   */
  private async assertNameAvailable(
    store: AppStore,
    name: string,
    env: string,
    excludeAppId?: string,
  ): Promise<void> {
    const key = name.trim().toLowerCase();
    const apps = await store.list();
    const duplicated = apps.find(
      (item) => item.appId !== excludeAppId && item.env === env && item.name.trim().toLowerCase() === key,
    );
    if (duplicated) throw new ConflictError(`环境 ${env} 下已存在同名应用「${duplicated.name}」`);
  }

  private async findEditable(appId: string): Promise<AnalyticsApp> {
    const store = this.store;
    const app = await store.find(appId);
    if (!app) {
      const envApp = this.deps.config.appSecrets[appId];
      if (envApp) {
        throw new ConflictError('该应用来自环境变量 APP_SECRETS，只能通过环境变量维护');
      }
      throw new NotFoundError('应用不存在');
    }
    return app;
  }
}

/**
 * appId 形如 `app-9f3c1a7b2d4e`：纯随机，不含应用名。
 * 应用名可能带业务/客户信息，写进 SDK 配置会被第三方看到，因此不参与生成。
 */
function buildAppId(): string {
  return `app-${randomBytes(6).toString('hex')}`;
}
