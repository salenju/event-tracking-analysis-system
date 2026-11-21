/**
 * 批次级拒绝：客户端会收到 200（避免 SDK 无限重试），服务端记录 rejected 日志。
 */
export class RejectBatchError extends Error {
    reason;
    detail;
    constructor(reason, detail) {
        super(detail ? `${reason}: ${detail}` : reason);
        this.name = 'RejectBatchError';
        this.reason = reason;
        if (detail)
            this.detail = detail;
    }
}
/** 请求参数非法，查询接口直接返回 400 */
export class BadRequestError extends Error {
    constructor(message) {
        super(message);
        this.name = 'BadRequestError';
    }
}
/** 未登录或会话过期 → 401，前端据此跳登录页 */
export class UnauthorizedError extends Error {
    code;
    constructor(message = 'login required', code = 'unauthorized') {
        super(message);
        this.name = 'UnauthorizedError';
        this.code = code;
    }
}
/** 已登录但权限不足 → 403 */
export class ForbiddenError extends Error {
    constructor(message = 'forbidden') {
        super(message);
        this.name = 'ForbiddenError';
    }
}
/** 资源不存在 → 404 */
export class NotFoundError extends Error {
    constructor(message = 'not found') {
        super(message);
        this.name = 'NotFoundError';
    }
}
/** 唯一键冲突等 → 409 */
export class ConflictError extends Error {
    constructor(message = 'conflict') {
        super(message);
        this.name = 'ConflictError';
    }
}
/** 依赖的外部服务（飞书开放平台）返回异常 → 502 */
export class UpstreamError extends Error {
    constructor(message) {
        super(message);
        this.name = 'UpstreamError';
    }
}
export function isDuplicateKeyError(error) {
    if (!error || typeof error !== 'object')
        return false;
    const err = error;
    return err.code === 'ER_DUP_ENTRY' || err.errno === 1062;
}
//# sourceMappingURL=errors.js.map