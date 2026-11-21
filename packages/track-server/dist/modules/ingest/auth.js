import { isWithinWindow, verifyPayload } from '../../lib/signature.js';
export const HEADERS = {
    appId: 'x-track-app-id',
    sentAt: 'x-track-sent-at',
    sign: 'x-track-sign',
};
function readHeader(headers, name) {
    const value = headers[name];
    if (typeof value === 'string' && value)
        return value;
    if (Array.isArray(value) && typeof value[0] === 'string')
        return value[0];
    return undefined;
}
function readQuery(query, name) {
    const value = query[name];
    if (typeof value === 'string' && value)
        return value;
    return undefined;
}
/**
 * 验签流程：
 * 1. appId 能查到密钥（管理后台创建的应用优先，其次环境变量 APP_SECRETS；停用视为不存在）
 * 2. sentAt 在 ±window 内，防重放
 * 3. HMAC(appId.sentAt.rawBody) 与签名一致
 *
 * 鉴权参数优先从请求头读取；sendBeacon 无法设置自定义头，
 * 因此降级到 query（?appId=&sentAt=&sign=）。
 * SIGN_REQUIRED=false 时只做白名单，用于本地联调。
 */
export async function authenticate(config, resolveSecret, headers, rawBody, query = {}, now = Date.now()) {
    const appId = readHeader(headers, HEADERS.appId) ?? readQuery(query, 'appId');
    if (!appId) {
        return { ok: false, reason: 'missing_app_id' };
    }
    const secret = await resolveSecret(appId);
    if (!secret) {
        return { ok: false, reason: 'unknown_app_id', detail: appId };
    }
    if (!config.signRequired) {
        return { ok: true, appId };
    }
    const sentAtRaw = readHeader(headers, HEADERS.sentAt) ?? readQuery(query, 'sentAt');
    const provided = readHeader(headers, HEADERS.sign) ?? readQuery(query, 'sign');
    if (!sentAtRaw || !provided) {
        return { ok: false, reason: 'missing_signature', detail: appId };
    }
    const sentAt = Number(sentAtRaw);
    if (!Number.isFinite(sentAt)) {
        return { ok: false, reason: 'invalid_sent_at', detail: sentAtRaw };
    }
    if (!isWithinWindow(sentAt, config.signWindowSeconds, now)) {
        return { ok: false, reason: 'stale_request', detail: sentAtRaw };
    }
    if (!verifyPayload(appId, sentAtRaw, rawBody, secret, provided)) {
        return { ok: false, reason: 'invalid_signature', detail: appId };
    }
    return { ok: true, appId };
}
//# sourceMappingURL=auth.js.map