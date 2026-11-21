import { send } from './client';
import type { AuthUser, UserRole, UserStatus } from './auth';

export type AppStatus = 'active' | 'disabled';

export interface AdminApp {
  appId: string;
  name: string;
  env: string;
  status: AppStatus;
  remark: string | null;
  /** db：管理后台创建；env：来自服务端环境变量，只读 */
  source: 'db' | 'env';
  secretMask: string;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SigningInfo {
  signRequired: boolean;
  signWindowSeconds: number;
  trackPath: string;
  env: string;
}

export interface AppListResult {
  apps: AdminApp[];
  signing: SigningInfo;
}

export interface CreateAppInput {
  name: string;
  env?: string;
  remark?: string;
}

export interface UpdateAppInput {
  name?: string;
  env?: string;
  status?: AppStatus;
  remark?: string | null;
}

export interface CreateAppResult {
  app: AdminApp;
  /** 明文密钥，只在创建/轮换时返回一次 */
  secret: string;
}

export async function fetchApps(): Promise<AppListResult> {
  return send<AppListResult & { ok: true }>('/api/admin/apps');
}

export function createApp(input: CreateAppInput): Promise<CreateAppResult> {
  return send<CreateAppResult & { ok: true }>('/api/admin/apps', { method: 'POST', body: input });
}

export async function updateApp(appId: string, patch: UpdateAppInput): Promise<AdminApp> {
  const data = await send<{ app: AdminApp }>(`/api/admin/apps/${encodeURIComponent(appId)}`, {
    method: 'PATCH',
    body: patch,
  });
  return data.app;
}

export function rotateAppSecret(appId: string): Promise<CreateAppResult> {
  return send<CreateAppResult & { ok: true }>(`/api/admin/apps/${encodeURIComponent(appId)}/rotate`, {
    method: 'POST',
  });
}

export async function deleteApp(appId: string): Promise<void> {
  await send<{ ok: true }>(`/api/admin/apps/${encodeURIComponent(appId)}`, { method: 'DELETE' });
}

export async function fetchUsers(): Promise<AuthUser[]> {
  const data = await send<{ users: AuthUser[] }>('/api/admin/users');
  return data.users ?? [];
}

export async function updateUser(
  id: number,
  patch: { role?: UserRole; status?: UserStatus },
): Promise<AuthUser> {
  const data = await send<{ user: AuthUser }>(`/api/admin/users/${id}`, { method: 'PATCH', body: patch });
  return data.user;
}
