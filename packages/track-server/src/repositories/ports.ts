import type { AdminUser, AnalyticsApp, FeishuProfile, UserRole, UserStatus } from '../domain/auth.js';

export interface AdminUserStore {
  findById(id: number): Promise<AdminUser | null>;
  findByOpenId(openId: string): Promise<AdminUser | null>;
  findByLocalUsername(username: string): Promise<AdminUser | null>;
  list(): Promise<AdminUser[]>;
  /** 库中是否已有可用管理员，用于「首个登录用户自动成为管理员」 */
  countActiveAdmins(): Promise<number>;
  /** 按 open_id 落库；已存在则刷新姓名/头像/邮箱，不改角色 */
  upsertFeishuUser(profile: FeishuProfile, role: UserRole, now: Date): Promise<AdminUser>;
  createLocalUser(username: string, role: UserRole, now: Date): Promise<AdminUser>;
  updateRole(id: number, role: UserRole, now: Date): Promise<void>;
  updateStatus(id: number, status: UserStatus, now: Date): Promise<void>;
  touchLogin(id: number, now: Date): Promise<void>;
}

export interface SessionRecord {
  tokenHash: string;
  userId: number;
  expiresAt: Date;
  ip: string | null;
  userAgent: string | null;
}

export interface SessionStore {
  create(record: SessionRecord, now: Date): Promise<void>;
  findUserIdByTokenHash(tokenHash: string, now: Date): Promise<number | null>;
  deleteByTokenHash(tokenHash: string): Promise<void>;
  deleteExpired(now: Date): Promise<void>;
}

export interface LoginStateStore {
  create(state: string, mode: string, expiresAt: Date, now: Date): Promise<void>;
  /** 一次性消费：返回 null 表示不存在、已过期或被并发请求先消费掉 */
  consume(state: string, now: Date): Promise<{ mode: string } | null>;
  deleteExpired(now: Date): Promise<void>;
}

export interface AppUpdatePatch {
  name?: string;
  env?: string;
  status?: 'active' | 'disabled';
  remark?: string | null;
}

export interface AppStore {
  list(): Promise<AnalyticsApp[]>;
  find(appId: string): Promise<AnalyticsApp | null>;
  insert(app: AnalyticsApp): Promise<void>;
  update(appId: string, patch: AppUpdatePatch, now: Date): Promise<void>;
  updateSecret(appId: string, secret: string, now: Date): Promise<void>;
  remove(appId: string): Promise<void>;
}
