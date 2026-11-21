import { BadRequestError } from '../domain/errors.js';
const OFFSET_PATTERN = /^[+-]\d{2}:\d{2}$/;
const HOUR_MS = 3600_000;
export function isValidOffset(value) {
    return OFFSET_PATTERN.test(value);
}
/**
 * 解析 from/to（ISO 8601 或毫秒时间戳）。
 * 缺省为最近 7 天，且强制 from < to，避免全表扫描。
 */
export function parseTimeRange(fromRaw, toRaw, now = Date.now()) {
    const to = parseInstant(toRaw, now);
    const from = parseInstant(fromRaw, to.getTime() - 7 * 24 * HOUR_MS);
    if (from >= to)
        throw new BadRequestError('from must be earlier than to');
    const maxRangeMs = 366 * 24 * HOUR_MS;
    if (to.getTime() - from.getTime() > maxRangeMs)
        throw new BadRequestError('time range must not exceed 366 days');
    return { from, to };
}
function parseInstant(raw, fallback) {
    if (raw === undefined || raw === '')
        return new Date(fallback);
    if (/^\d+$/.test(raw)) {
        const value = Number(raw);
        const ms = raw.length <= 10 ? value * 1000 : value;
        return new Date(ms);
    }
    const parsed = Date.parse(raw);
    if (Number.isNaN(parsed))
        throw new BadRequestError(`invalid datetime: ${raw}`);
    return new Date(parsed);
}
/** 客户端时间明显异常（偏差超过 24h）时回退到服务端时间，避免污染趋势 */
export function sanitizeOccurredAt(clientTs, receivedAt, maxSkewMs = 24 * HOUR_MS) {
    if (!Number.isFinite(clientTs))
        return receivedAt;
    if (Math.abs(receivedAt.getTime() - clientTs) > maxSkewMs)
        return receivedAt;
    return new Date(clientTs);
}
/** 按时间跨度自动选择按天或按小时聚合 */
export function pickGranularity(range) {
    return range.to.getTime() - range.from.getTime() <= 48 * HOUR_MS ? 'hour' : 'day';
}
export function normalizeOffset(raw, fallback) {
    if (!raw)
        return fallback;
    if (!isValidOffset(raw))
        throw new BadRequestError(`invalid tzOffset: ${raw} (expected e.g. +08:00)`);
    return raw;
}
//# sourceMappingURL=time.js.map