import { BadRequestError, UpstreamError } from '../../domain/errors.js';
const TIMEOUT_MS = 8000;
/**
 * 飞书网页应用登录（OAuth 2.0 授权码模式）。
 *
 * 换 token 走 v2 接口：POST /open-apis/authen/v2/oauth/token，
 * 请求体为 JSON（grant_type / client_id / client_secret / code / redirect_uri）。
 * 拉用户信息走 v1：GET /open-apis/authen/v1/user_info，Bearer user_access_token。
 */
export class FeishuClient {
    config;
    constructor(config) {
        this.config = config;
    }
    async exchangeCode(code) {
        if (!this.config.enabled) {
            throw new BadRequestError('飞书登录未配置：请设置 FEISHU_APP_ID / FEISHU_APP_SECRET');
        }
        const tokenBody = await this.postJson(`${this.config.apiBase}/open-apis/authen/v2/oauth/token`, {
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
        const userInfo = await this.getJson(`${this.config.apiBase}/open-apis/authen/v1/user_info`, {
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
    async postJson(url, body) {
        let response;
        try {
            response = await fetch(url, {
                method: 'POST',
                headers: { 'content-type': 'application/json; charset=utf-8' },
                body: JSON.stringify(body),
                signal: AbortSignal.timeout(TIMEOUT_MS),
            });
        }
        catch {
            throw new UpstreamError('无法访问飞书开放平台，请检查网络或 FEISHU_API_BASE');
        }
        const payload = (await this.parseJson(response));
        return payload;
    }
    async getJson(url, headers) {
        let response;
        try {
            response = await fetch(url, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
        }
        catch {
            throw new UpstreamError('无法访问飞书开放平台，请检查网络或 FEISHU_API_BASE');
        }
        return (await this.parseJson(response));
    }
    async parseJson(response) {
        try {
            return await response.json();
        }
        catch {
            throw new UpstreamError(`飞书开放平台返回非 JSON（HTTP ${response.status}）`);
        }
    }
}
//# sourceMappingURL=feishu.client.js.map