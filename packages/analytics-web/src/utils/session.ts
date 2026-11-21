import { reactive } from 'vue';
import { fetchAuthConfig, fetchCurrentUser, logout as apiLogout, type AuthUser } from '@/api/auth';
import { setToken } from '@/utils/token';

export interface SessionState {
  user: AuthUser | null;
  /** 会话已探测过（避免每次路由跳转都打 /api/auth/me） */
  ready: boolean;
  configLoaded: boolean;
  authRequired: boolean;
  feishuEnabled: boolean;
  devLoginEnabled: boolean;
}

/** 全局登录态：轻量 reactive，不引入 pinia */
export const session = reactive<SessionState>({
  user: null,
  ready: false,
  configLoaded: false,
  authRequired: false,
  feishuEnabled: false,
  devLoginEnabled: false,
});

export async function ensureAuthConfig(): Promise<void> {
  if (session.configLoaded) return;
  try {
    const config = await fetchAuthConfig();
    session.authRequired = config.authRequired;
    session.feishuEnabled = config.feishuEnabled;
    session.devLoginEnabled = config.devLoginEnabled;
  } catch {
    // 后端不可达时不做任何假设，交给页面自己报错
  }
  session.configLoaded = true;
}

export async function ensureSession(force = false): Promise<AuthUser | null> {
  if (session.ready && !force) return session.user;
  try {
    session.user = await fetchCurrentUser();
  } catch {
    session.user = null;
  }
  session.ready = true;
  return session.user;
}

/** 登录成功后写入 token 与用户态 */
export function applyLogin(user: AuthUser, token: string): void {
  setToken(token);
  session.user = user;
  session.ready = true;
}

export async function signOut(): Promise<void> {
  try {
    await apiLogout();
  } catch {
    // 即使后端调用失败也要清掉本地态
  }
  setToken(null);
  session.user = null;
  session.ready = true;
}

export function isAdmin(): boolean {
  return session.user?.role === 'admin';
}
