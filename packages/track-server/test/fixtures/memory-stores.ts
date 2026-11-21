import type { AdminUser, AnalyticsApp, FeishuProfile, UserRole, UserStatus } from '../../src/domain/auth.js';
import type { AdminUserStore, AppStore, AppUpdatePatch, LoginStateStore, SessionStore } from '../../src/repositories/ports.js';

function duplicateError(): Error {
  const error = new Error('Duplicate entry') as Error & { code?: string; errno?: number };
  error.code = 'ER_DUP_ENTRY';
  error.errno = 1062;
  return error;
}

export class MemoryAdminUserStore implements AdminUserStore {
  readonly users: AdminUser[] = [];
  private nextId = 1;

  async findById(id: number): Promise<AdminUser | null> {
    return this.users.find((user) => user.id === id) ?? null;
  }

  async findByOpenId(openId: string): Promise<AdminUser | null> {
    return this.users.find((user) => user.openId === openId) ?? null;
  }

  async findByLocalUsername(username: string): Promise<AdminUser | null> {
    return this.users.find((user) => user.localUsername === username) ?? null;
  }

  async list(): Promise<AdminUser[]> {
    return [...this.users];
  }

  async countActiveAdmins(): Promise<number> {
    return this.users.filter((user) => user.role === 'admin' && user.status === 'active').length;
  }

  async upsertFeishuUser(profile: FeishuProfile, role: UserRole, now: Date): Promise<AdminUser> {
    const existing = await this.findByOpenId(profile.openId);
    if (existing) {
      existing.name = profile.name;
      existing.avatarUrl = profile.avatarUrl;
      existing.email = profile.email;
      return existing;
    }
    const user: AdminUser = {
      id: this.nextId++,
      openId: profile.openId,
      unionId: profile.unionId,
      feishuUserId: profile.userId,
      name: profile.name,
      avatarUrl: profile.avatarUrl,
      email: profile.email,
      role,
      status: 'active',
      source: 'feishu',
      localUsername: null,
      createdAt: now,
      lastLoginAt: null,
    };
    this.users.push(user);
    return user;
  }

  async createLocalUser(username: string, role: UserRole, now: Date): Promise<AdminUser> {
    const user: AdminUser = {
      id: this.nextId++,
      openId: null,
      unionId: null,
      feishuUserId: null,
      name: username,
      avatarUrl: null,
      email: null,
      role,
      status: 'active',
      source: 'local',
      localUsername: username,
      createdAt: now,
      lastLoginAt: null,
    };
    this.users.push(user);
    return user;
  }

  async updateRole(id: number, role: UserRole): Promise<void> {
    const user = await this.findById(id);
    if (user) user.role = role;
  }

  async updateStatus(id: number, status: UserStatus): Promise<void> {
    const user = await this.findById(id);
    if (user) user.status = status;
  }

  async touchLogin(id: number, now: Date): Promise<void> {
    const user = await this.findById(id);
    if (user) user.lastLoginAt = now;
  }
}

export class MemorySessionStore implements SessionStore {
  readonly sessions = new Map<string, { userId: number; expiresAt: Date }>();

  async create(record: { tokenHash: string; userId: number; expiresAt: Date }): Promise<void> {
    this.sessions.set(record.tokenHash, { userId: record.userId, expiresAt: record.expiresAt });
  }

  async findUserIdByTokenHash(tokenHash: string, now: Date): Promise<number | null> {
    const row = this.sessions.get(tokenHash);
    if (!row || row.expiresAt.getTime() <= now.getTime()) return null;
    return row.userId;
  }

  async deleteByTokenHash(tokenHash: string): Promise<void> {
    this.sessions.delete(tokenHash);
  }

  async deleteExpired(now: Date): Promise<void> {
    for (const [key, row] of this.sessions.entries()) {
      if (row.expiresAt.getTime() <= now.getTime()) this.sessions.delete(key);
    }
  }
}

export class MemoryLoginStateStore implements LoginStateStore {
  readonly states = new Map<string, { mode: string; expiresAt: Date }>();

  async create(state: string, mode: string, expiresAt: Date): Promise<void> {
    this.states.set(state, { mode, expiresAt });
  }

  async consume(state: string, now: Date): Promise<{ mode: string } | null> {
    const row = this.states.get(state);
    if (!row) return null;
    this.states.delete(state);
    return row.expiresAt.getTime() > now.getTime() ? { mode: row.mode } : null;
  }

  async deleteExpired(now: Date): Promise<void> {
    for (const [key, row] of this.states.entries()) {
      if (row.expiresAt.getTime() <= now.getTime()) this.states.delete(key);
    }
  }
}

export class MemoryAppStore implements AppStore {
  readonly apps = new Map<string, AnalyticsApp>();

  async list(): Promise<AnalyticsApp[]> {
    return [...this.apps.values()];
  }

  async find(appId: string): Promise<AnalyticsApp | null> {
    return this.apps.get(appId) ?? null;
  }

  async insert(app: AnalyticsApp): Promise<void> {
    if (this.apps.has(app.appId)) throw duplicateError();
    this.apps.set(app.appId, { ...app });
  }

  async update(appId: string, patch: AppUpdatePatch, now: Date): Promise<void> {
    const app = this.apps.get(appId);
    if (!app) return;
    if (patch.name !== undefined) app.name = patch.name;
    if (patch.env !== undefined) app.env = patch.env;
    if (patch.status !== undefined) app.status = patch.status;
    if (patch.remark !== undefined) app.remark = patch.remark;
    app.updatedAt = now;
  }

  async updateSecret(appId: string, secret: string, now: Date): Promise<void> {
    const app = this.apps.get(appId);
    if (!app) return;
    app.secret = secret;
    app.updatedAt = now;
  }

  async remove(appId: string): Promise<void> {
    this.apps.delete(appId);
  }
}
