import type { AppConfig } from '../../config/index.js';
import type { FeishuProfile } from '../../domain/auth.js';
import { BadRequestError, UpstreamError } from '../../domain/errors.js';

export interface FeishuGateway {
  /** 用授权码换 user_access_token，再拉一次用户信息 */
  exchangeCode(code: string): Promise<FeishuProfile>;
}

interface TokenPayload {
  code?: number;
  msg?: string;
  error?: string;
  error_description?: string;
  access_token?: string;
}

interface UserInfoPayload {
  code?: number;
  msg?: string;
  data?: {
    open_id?: string;
    union_id?: string;
    user_id?: string;
    name?: string;
    avatar_url?: string;
    email?: string;
    enterprise_email?: string;
  };
}

const TIMEOUT_MS = 8000;

/**
 * 飞书网页应用登录（OAuth 2.0 授权码模式）。
 *
 * 换 token 走 v2 接口：POST /open-apis/authen/v2/oauth/token，
 * 请求体为 JSON（grant_type / client_id / client_secret / code / redirect_uri）。
 * 拉用户信息走 v1：GET /open-apis/authen/v1/user_info，Bearer user_access_token。
 */
export class FeishuClient implements FeishuGateway {
  constructor(private readonly config: AppConfig['feishu']) {}

  async exchangeCode(code: string): Promise<FeishuProfile> {
    if (!this.config.enabled) {
      throw new BadRequestError('飞书登录未配置：请设置 FEISHU_APP_ID / FEISHU_APP_SECRET');
    }

    const tokenBody = await this.postJson<TokenPayload>(`${this.config.apiBase}/open-apis/authen/v2/oauth/token`, {
      grant_type: 'authorization_code',
      client_id: this.config.appId,
      client_secret: this.config.appSecret,
      code,
      redirect_uri: this.config.redirectUri,
    });

    if (tokenBody.code !== 0 || !tokenBody.access_token) {
      const detail = tokenBody.error_description ?? tokenBody.error ?? tokenBody.msg ?? `code=${tokenBody.code}`;
      throw new BadRequestError(`飞书授权码换取 token 失败：${detail}`);
    }

    const userInfo = await this.getJson<UserInfoPayload>(`${this.config.apiBase}/open-apis/authen/v1/user_info`, {
      authorization: `Bearer ${tokenBody.access_token}`,
    });

    const data = userInfo.data;
    if (userInfo.code !== 0 || !data?.open_id) {
      throw new UpstreamError(`飞书用户信息获取失败：${userInfo.msg ?? `code=${userInfo.code}`}`);
    }

    return {
      openId: data.open_id,
      unionId: data.union_id ?? null,
      userId: data.user_id ?? null,
      name: data.name ?? data.open_id,
      avatarUrl: data.avatar_url ?? null,
      email: data.enterprise_email ?? data.email ?? null,
    };
  }

  private async postJson<T>(url: string, body: unknown): Promise<T> {
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json; charset=utf-8' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      throw new UpstreamError('无法访问飞书开放平台，请检查网络或 FEISHU_API_BASE');
    }
    const payload = (await this.parseJson(response)) as T;
    return payload;
  }

  private async getJson<T>(url: string, headers: Record<string, string>): Promise<T> {
    let response: Response;
    try {
      response = await fetch(url, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch {
      throw new UpstreamError('无法访问飞书开放平台，请检查网络或 FEISHU_API_BASE');
    }
    return (await this.parseJson(response)) as T;
  }

  private async parseJson(response: Response): Promise<unknown> {
    try {
      return await response.json();
    } catch {
      throw new UpstreamError(`飞书开放平台返回非 JSON（HTTP ${response.status}）`);
    }
  }
}
