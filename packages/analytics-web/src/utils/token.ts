const STORAGE_KEY = 'et.auth.token';

let cached: string | null | undefined;

/** 登录 token 存在 localStorage：刷新页面不用重新扫码 */
export function getToken(): string | null {
  if (cached !== undefined) return cached;
  try {
    cached = localStorage.getItem(STORAGE_KEY);
  } catch {
    cached = null;
  }
  return cached;
}

export function setToken(token: string | null): void {
  cached = token;
  try {
    if (token) localStorage.setItem(STORAGE_KEY, token);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // 隐私模式下 localStorage 不可用，退化为内存态
  }
}
