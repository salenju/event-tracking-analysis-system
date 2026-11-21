const MAX_DETAIL_CHARS = 2048;
/**
 * 被拒绝 / 丢弃的批次写一行结构化 WARN 日志。
 * 这是"客户端已收到 200、但数据没入库"的唯一补偿线索，保留 7 天可人工补导。
 */
export function logRejected(logger, ctx) {
    logger.warn({
        trackEvent: 'batch_rejected',
        appId: ctx.appId,
        batchId: ctx.batchId,
        reason: ctx.reason,
        detail: ctx.detail,
        ip: ctx.ip,
        bodyBytes: ctx.rawBody.length,
        bodyPreview: ctx.rawBody.slice(0, MAX_DETAIL_CHARS),
    }, 'track batch rejected');
}
//# sourceMappingURL=rejected.logger.js.map