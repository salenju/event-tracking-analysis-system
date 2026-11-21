import { ForbiddenError, UnauthorizedError } from '../../domain/errors.js';
/** 无需登录即可访问的路径（埋点上报、健康检查、登录入口本身） */
const OPEN_PREFIXES = [
    '/api/track',
    '/healthz',
    '/readyz',
    '/api/auth/config',
    '/api/auth/dev-login',
    '/api/auth/feishu/',
];
function isOpenPath(url) {
    return OPEN_PREFIXES.some((prefix) => url === prefix || url.startsWith(prefix));
}
export function readBearerToken(headers) {
    const raw = headers.authorization;
    const value = typeof raw === 'string' ? raw : Array.isArray(raw) && typeof raw[0] === 'string' ? raw[0] : undefined;
    if (!value)
        return null;
    const match = /^Bearer\s+(.+)$/i.exec(value.trim());
    return match?.[1]?.trim() || null;
}
export function requireUser(request) {
    if (!request.auth)
        throw new UnauthorizedError();
    return request.auth.user;
}
export function requireAdmin(request) {
    const user = requireUser(request);
    if (user.role !== 'admin')
        throw new ForbiddenError('需要管理员权限');
    return user;
}
/**
 * 统一鉴权：所有 /api/* 默认要求登录，/api/admin/* 额外要求管理员。
 * AUTH_REQUIRED=false（本地默认）时只解析身份不拦截，方便脱网调试。
 */
export function registerAuthGuard(app, deps) {
    app.addHook('onRequest', async (request) => {
        const url = request.url.split('?')[0] ?? '';
        if (request.method === 'OPTIONS')
            return;
        if (!url.startsWith('/api/') || url.startsWith('/api/track'))
            return;
        const token = readBearerToken(request.headers);
        if (token) {
            const user = await deps.auth.resolveToken(token);
            if (user)
                request.auth = { user, token };
        }
        if (!deps.config.authRequired || isOpenPath(url))
            return;
        if (!request.auth)
            throw new UnauthorizedError();
        if (url.startsWith('/api/admin/') && request.auth.user.role !== 'admin') {
            throw new ForbiddenError('需要管理员权限');
        }
    });
}
//# sourceMappingURL=guard.js.map