import { getToken, setToken } from '@/utils/token';

const BASE = (import.meta.env.VITE_API_BASE ?? '').replace(/\/+$/, '');

export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

type QueryValue = string | number | undefined | null;

export interface SendOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  params?: Record<string, QueryValue>;
  body?: unknown;
  /** 401 时是否自动跳登录页，默认 true；探测会话的请求要传 false */
  redirectOnUnauthorized?: boolean;
}

function buildUrl(path: string, params: Record<string, QueryValue> = {}): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    search.append(key, String(value));
  }
  const qs = search.toString();
  return `${BASE}${path}${qs ? `?${qs}` : ''}`;
}

function redirectToLogin(message: string): void {
  if (typeof window === 'undefined') return;
  if (window.location.pathname.startsWith('/login')) return;
  const redirect = encodeURIComponent(`${window.location.pathname}${window.location.search}`);
  window.location.assign(`/login?error=${encodeURIComponent(message)}&redirect=${redirect}`);
}

/**
 * 统一处理查询串拼接、鉴权头、非 2xx 与 { ok: false } 响应。
 * 服务端用 Authorization: Bearer 而不是 cookie，避免 CORS credentials 与通配来源冲突。
 */
export async function send<T>(path: string, options: SendOptions = {}): Promise<T> {
  const method = options.method ?? 'GET';
  const headers: Record<string, string> = { accept: 'application/json' };
  const token = getToken();
  if (token) headers.authorization = `Bearer ${token}`;

  const init: RequestInit = { method, headers };
  if (options.body !== undefined) {
    headers['content-type'] = 'application/json';
    init.body = JSON.stringify(options.body);
  }

  let response: Response;
  try {
    response = await fetch(buildUrl(path, options.params), init);
  } catch {
    throw new ApiError('无法连接埋点服务，请确认 track-server 已启动', 0);
  }

  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  const payload = (body ?? {}) as { ok?: boolean; error?: string; message?: string };

  if (response.status === 401) {
    setToken(null);
    if (options.redirectOnUnauthorized !== false) {
      redirectToLogin(payload.message ?? '登录已过期，请重新登录');
    }
    throw new ApiError(payload.message ?? '未登录', 401);
  }

  if (!response.ok) {
    const message = payload.message ?? payload.error ?? `请求失败（HTTP ${response.status}）`;
    throw new ApiError(String(message), response.status);
  }
  if (payload.ok === false) {
    throw new ApiError(String(payload.error ?? '请求失败'), response.status);
  }
  return body as T;
}

/** 兼容原有查询接口调用方式 */
export function request<T>(path: string, params: Record<string, QueryValue> = {}): Promise<T> {
  return send<T>(path, { params });
}
