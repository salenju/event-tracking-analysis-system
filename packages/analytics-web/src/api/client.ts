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

/** 统一处理查询串拼接、非 2xx 与 { ok: false } 响应 */
export async function request<T>(path: string, params: Record<string, QueryValue> = {}): Promise<T> {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    search.append(key, String(value));
  }
  const qs = search.toString();
  const url = `${BASE}${path}${qs ? `?${qs}` : ''}`;

  let response: Response;
  try {
    response = await fetch(url, { headers: { accept: 'application/json' } });
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

  if (!response.ok) {
    const message = payload.message ?? payload.error ?? `请求失败（HTTP ${response.status}）`;
    throw new ApiError(String(message), response.status);
  }
  if (payload.ok === false) {
    throw new ApiError(String(payload.error ?? '请求失败'), response.status);
  }
  return body as T;
}
