import { COLUMN_LIMITS, DIMENSION_FIELDS, RECORD_TYPE_EVENT } from '../../domain/events.js';
import { sanitizeOccurredAt } from '../../lib/time.js';
import { recordSchema } from './payload.schema.js';
export function truncate(value, max) {
    if (value === undefined || value === null)
        return null;
    const text = String(value).trim();
    if (!text)
        return null;
    return text.length > max ? text.slice(0, max) : text;
}
function pickDimension(properties, keys) {
    for (const key of keys) {
        const value = properties[key];
        if (typeof value === 'string' && value.trim())
            return value.trim();
        if (typeof value === 'number')
            return String(value);
    }
    return null;
}
/**
 * 单条记录归一化：
 * - 结构非法 → 跳过该条（不影响同批其他记录）
 * - 超长字段 → 截断（否则整批 INSERT 失败）
 * - properties 超限 → 丢弃该条
 */
export function normalizeRecord(input, ctx) {
    const parsed = recordSchema.safeParse(input);
    if (!parsed.success) {
        return { ok: false, reason: 'invalid_record' };
    }
    const record = parsed.data;
    const recordType = truncate(record.type, COLUMN_LIMITS.recordType) ?? 'unknown';
    let event = null;
    // 非 event 记录（performance / error 等）整体存入 properties，便于排障
    let properties = record.data;
    if (recordType === RECORD_TYPE_EVENT) {
        const rawEvent = record.data.event;
        if (typeof rawEvent !== 'string' || !rawEvent.trim()) {
            return { ok: false, reason: 'missing_event_name' };
        }
        event = truncate(rawEvent, COLUMN_LIMITS.event);
        const rawProps = record.data.properties;
        properties =
            rawProps && typeof rawProps === 'object' && !Array.isArray(rawProps)
                ? rawProps
                : {};
    }
    let propertiesText;
    try {
        propertiesText = JSON.stringify(properties);
    }
    catch {
        return { ok: false, reason: 'unserializable_properties' };
    }
    if (propertiesText.length > ctx.maxRecordBytes) {
        return { ok: false, reason: 'properties_too_large' };
    }
    return {
        ok: true,
        row: {
            batchId: ctx.batchId,
            appId: ctx.appId,
            env: ctx.env,
            recordType,
            event,
            userId: truncate(ctx.userId, COLUMN_LIMITS.userId),
            sessionId: truncate(ctx.sessionId, COLUMN_LIMITS.sessionId) ?? 'unknown',
            orderId: truncate(pickDimension(properties, DIMENSION_FIELDS.orderId), COLUMN_LIMITS.orderId),
            walletType: truncate(pickDimension(properties, DIMENSION_FIELDS.walletType), COLUMN_LIMITS.walletType),
            failReason: truncate(pickDimension(properties, DIMENSION_FIELDS.failReason), COLUMN_LIMITS.failReason),
            properties: propertiesText,
            occurredAt: sanitizeOccurredAt(record.timestamp, ctx.receivedAt),
            receivedAt: ctx.receivedAt,
        },
    };
}
//# sourceMappingURL=normalizer.js.map