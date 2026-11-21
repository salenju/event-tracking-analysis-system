import type { AnalyticsApp } from '../domain/auth.js';
import type { AppStore } from '../repositories/ports.js';

interface CacheEntry {
  secret: string | null;
  expiresAt: number;
}

const DEFAULT_TTL_MS = 30_000;
const MISS_TTL_MS = 10_000;
const DB_COOLDOWN_MS = 5_000;

/**
 * 埋点验签用的密钥来源。
 *
 * 优先级：管理后台创建的应用（analytics_apps） > 环境变量 APP_SECRETS。
 * 环境变量保留给存量接入与纯上报模式（START_MODE=ingest，没有管理后台）。
 *
 * 缓存是必要的：每个上报请求都要查密钥，直连 DB 会把查询池打满。
 * 管理端的新增/轮换/停用会调用 invalidate() 立即失效。
 */
export class AppRegistry {
  private readonly cache = new Map<string, CacheEntry>();
  /** DB 故障后的短冷却，避免每个上报请求都去打一张查不到的表 */
  private dbDownUntil = 0;

  constructor(
    private readonly store: AppStore | null,
    private readonly envSecrets: Record<string, string>,
    private readonly ttlMs: number = DEFAULT_TTL_MS,
  ) {}

  async resolveSecret(appId: string): Promise<string | undefined> {
    const now = Date.now();
    const cached = this.cache.get(appId);
    if (cached && cached.expiresAt > now) {
      return cached.secret ?? undefined;
    }

    if (this.store && now >= this.dbDownUntil) {
      try {
        const app = await this.store.find(appId);
        if (app) {
          const secret = app.status === 'active' ? app.secret : null;
          this.cache.set(appId, { secret, expiresAt: now + this.ttlMs });
          return secret ?? undefined;
        }
      } catch (error) {
        // DB 抖动时不能让环境变量里的存量应用一起挂掉，但也不能伪装成「应用不存在」：
        // 有 env 兜底就用兜底，没有就把错误抛出去，让接口返回 503 由 SDK 重试。
        this.dbDownUntil = now + DB_COOLDOWN_MS;
        const fallback = this.envSecrets[appId];
        if (fallback) {
          this.cache.set(appId, { secret: fallback, expiresAt: now + this.ttlMs });
          return fallback;
        }
        throw error;
      }
    }

    const envSecret = this.envSecrets[appId];
    this.cache.set(appId, { secret: envSecret ?? null, expiresAt: now + (envSecret ? this.ttlMs : MISS_TTL_MS) });
    return envSecret;
  }

  invalidate(appId?: string): void {
    if (appId) {
      this.cache.delete(appId);
      return;
    }
    this.cache.clear();
  }

  /** 管理后台列表：DB 应用 + 环境变量应用（只读） */
  async listApps(): Promise<AnalyticsApp[]> {
    const dbApps = this.store ? await this.store.list() : [];
    const known = new Set(dbApps.map((app) => app.appId));
    const now = new Date(0);
    const envApps: AnalyticsApp[] = Object.keys(this.envSecrets)
      .filter((appId) => !known.has(appId))
      .map((appId) => ({
        appId,
        name: appId,
        secret: this.envSecrets[appId] ?? '',
        env: 'env',
        status: 'active',
        remark: '来自环境变量 APP_SECRETS，只读',
        createdBy: 'env',
        createdAt: now,
        updatedAt: now,
        source: 'env',
      }));
    return [...dbApps, ...envApps];
  }
}

/** 列表/日志里只暴露首尾各 4 位 */
export function maskSecret(secret: string): string {
  if (!secret) return '';
  if (secret.length <= 8) return '****';
  return `${secret.slice(0, 4)}${'*'.repeat(Math.min(16, secret.length - 8))}${secret.slice(-4)}`;
}
