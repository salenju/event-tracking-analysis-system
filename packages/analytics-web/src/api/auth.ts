import { send } from './client';

export type UserRole = 'admin' | 'viewer';
export type UserStatus = 'active' | 'disabled';

export interface AuthUser {
  id: number;
  name: string;
  avatarUrl: string | null;
  email: string | null;
  role: UserRole;
  status: UserStatus;
  source: 'feishu' | 'local';
  localUsername: string | null;
  openId: string | null;
  createdAt: string;
  lastLoginAt: string | null;
}

export interface AuthConfig {
  feishuEnabled: boolean;
  devLoginEnabled: boolean;
  authRequired: boolean;
}

export async function fetchAuthConfig(): Promise<AuthConfig> {
  const data = await send<AuthConfig & { ok: true }>('/api/auth/config');
  return {
    feishuEnabled: Boolean(data.feishuEnabled),
    devLoginEnabled: Boolean(data.devLoginEnabled),
    authRequired: Boolean(data.authRequired),
  };
}

/** 探测当前会话；未登录返回 null（不触发跳转） */
export async function fetchCurrentUser(): Promise<AuthUser | null> {
  const data = await send<{ user: AuthUser | null; authRequired: boolean }>('/api/auth/me', {
    redirectOnUnauthorized: false,
  });
  return data.user ?? null;
}

export interface FeishuLoginUrl {
  url: string;
  state: string;
  expiresIn: number;
}

export function fetchFeishuLoginUrl(mode: 'qr' | 'redirect'): Promise<FeishuLoginUrl> {
  return send<FeishuLoginUrl & { ok: true }>('/api/auth/feishu/login-url', {
    params: { mode },
    redirectOnUnauthorized: false,
  });
}

export function devLogin(username: string): Promise<{ token: string; user: AuthUser }> {
  return send<{ token: string; user: AuthUser }>('/api/auth/dev-login', {
    method: 'POST',
    body: { username },
    redirectOnUnauthorized: false,
  });
}

export async function logout(): Promise<void> {
  await send<{ ok: true }>('/api/auth/logout', { method: 'POST', redirectOnUnauthorized: false });
}
