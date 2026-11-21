import { randomBytes } from 'node:crypto';
import { BadRequestError, ConflictError, isDuplicateKeyError, NotFoundError } from '../../domain/errors.js';
import { maskSecret } from '../../lib/app-secret.js';
import { toPublicUser } from '../auth/user.dto.js';
const APP_NAME_MAX = 64;
const ENV_PATTERN = /^[a-z0-9_-]{1,16}$/;
export function toPublicApp(app) {
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
function assertName(name) {
    const trimmed = name.trim();
    if (!trimmed)
        throw new BadRequestError('应用名称不能为空');
    if (trimmed.length > APP_NAME_MAX)
        throw new BadRequestError(`应用名称不能超过 ${APP_NAME_MAX} 个字符`);
    return trimmed;
}
function assertEnv(env) {
    const value = env.trim().toLowerCase();
    if (!ENV_PATTERN.test(value))
        throw new BadRequestError('env 只能是 1-16 位小写字母、数字、下划线或中划线');
    return value;
}
export class AppsService {
    deps;
    now;
    constructor(deps) {
        this.deps = deps;
        this.now = deps.now ?? (() => new Date());
    }
    get store() {
        if (!this.deps.store)
            throw new ConflictError('当前模式未启用应用注册表（START_MODE=ingest）');
        return this.deps.store;
    }
    async list() {
        const apps = await this.deps.registry.listApps();
        return apps.map(toPublicApp);
    }
    async create(input, actor) {
        const store = this.store;
        const name = assertName(input.name);
        const env = input.env ? assertEnv(input.env) : this.deps.config.trackEnv;
        const remark = input.remark?.trim() ? input.remark.trim().slice(0, 255) : null;
        const now = this.now();
        const secret = randomBytes(24).toString('hex');
        for (let attempt = 0; attempt < 5; attempt += 1) {
            const appId = buildAppId(name);
            const app = {
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
            }
            catch (error) {
                if (!isDuplicateKeyError(error))
                    throw error;
            }
        }
        throw new ConflictError('生成 appId 失败，请重试');
    }
    async update(appId, patch) {
        const existing = await this.findEditable(appId);
        const normalized = {};
        if (patch.name !== undefined)
            normalized.name = assertName(patch.name);
        if (patch.env !== undefined)
            normalized.env = assertEnv(patch.env);
        if (patch.status !== undefined)
            normalized.status = patch.status;
        if (patch.remark !== undefined)
            normalized.remark = patch.remark?.trim() ? patch.remark.trim().slice(0, 255) : null;
        await this.store.update(existing.appId, normalized, this.now());
        // 停用后必须立刻让验签侧看到，不能等缓存过期
        this.deps.registry.invalidate(existing.appId);
        const updated = await this.store.find(existing.appId);
        if (!updated)
            throw new NotFoundError('应用不存在');
        return toPublicApp(updated);
    }
    async rotate(appId) {
        const existing = await this.findEditable(appId);
        const secret = randomBytes(24).toString('hex');
        await this.store.updateSecret(existing.appId, secret, this.now());
        this.deps.registry.invalidate(existing.appId);
        const updated = (await this.store.find(existing.appId)) ?? { ...existing, secret };
        return { app: toPublicApp(updated), secret };
    }
    async remove(appId) {
        const existing = await this.findEditable(appId);
        await this.store.remove(existing.appId);
        this.deps.registry.invalidate(existing.appId);
    }
    async listUsers() {
        const users = await this.deps.users.list();
        return users.map(toPublicUser);
    }
    async updateUser(id, patch, actor) {
        const target = await this.deps.users.findById(id);
        if (!target)
            throw new NotFoundError('用户不存在');
        if (patch.role === undefined && patch.status === undefined) {
            throw new BadRequestError('至少需要修改 role 或 status');
        }
        const losingAdmin = target.role === 'admin' && (patch.role === 'viewer' || patch.status === 'disabled');
        if (losingAdmin) {
            if (target.id === actor.id)
                throw new ConflictError('不能降级或停用自己');
            const admins = await this.deps.users.countActiveAdmins();
            if (admins <= 1)
                throw new ConflictError('至少要保留一个可用管理员');
        }
        if (patch.role !== undefined)
            await this.deps.users.updateRole(target.id, patch.role, this.now());
        if (patch.status !== undefined)
            await this.deps.users.updateStatus(target.id, patch.status, this.now());
        const updated = await this.deps.users.findById(target.id);
        if (!updated)
            throw new NotFoundError('用户不存在');
        return toPublicUser(updated);
    }
    async findEditable(appId) {
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
/** appId 形如 `storefront-1a2b3c4d`：前缀便于人工识别，后缀保证唯一 */
function buildAppId(name) {
    const slug = name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 24);
    return `${slug || 'app'}-${randomBytes(4).toString('hex')}`;
}
//# sourceMappingURL=apps.service.js.map