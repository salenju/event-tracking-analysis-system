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
export function isDuplicateKeyError(error) {
    if (!error || typeof error !== 'object')
        return false;
    const err = error;
    return err.code === 'ER_DUP_ENTRY' || err.errno === 1062;
}
//# sourceMappingURL=errors.js.map