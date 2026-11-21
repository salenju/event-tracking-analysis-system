import { COLUMN_LIMITS } from '../../domain/events.js';
import { RejectBatchError } from '../../domain/errors.js';
import { extractPath, parseUserAgent } from '../../lib/ua.js';
import { insertBatchIfAbsent } from '../../repositories/batch.repo.js';
import { bulkInsertEvents } from '../../repositories/event.repo.js';
import { normalizeRecord, truncate } from './normalizer.js';
import { envelopeSchema } from './payload.schema.js';
/** 信封层已知字段；出现未登记字段说明协议在演进而服务端还没跟上，要报警而不是静默丢弃 */
const KNOWN_ENVELOPE_KEYS = new Set([
    'appId',
    'sdkVersion',
    'userId',
    'sessionId',
    'batchId',
    'sentAt',
    'env',
    'context',
    'batch',
]);
function readContextString(context, key) {
    const value = context[key];
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}
/**
 * 埋点入库主流程。
 * 抛出 RejectBatchError 表示"客户端应视为成功、但数据不入库"（由路由层转 200 + 日志）；
 * 其他异常（DB 故障等）由错误处理器转 503，交给 SDK 重试。
 */
export async function ingestBatch(deps, request) {
    const { config, db, logger } = deps;
    const receivedAt = request.receivedAt ?? new Date();
    let parsed;
    try {
        parsed = JSON.parse(request.rawBody);
    }
    catch {
        throw new RejectBatchError('invalid_json');
    }
    const envelope = envelopeSchema.safeParse(parsed);
    if (!envelope.success) {
        const detail = envelope.error.issues
            .slice(0, 5)
            .map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
            .join('; ');
        throw new RejectBatchError('invalid_payload', detail);
    }
    const payload = envelope.data;
    if (payload.appId !== request.appId) {
        throw new RejectBatchError('app_id_mismatch', `header=${request.appId} body=${payload.appId}`);
    }
    if (payload.batch.length > config.maxRecordsPerBatch) {
        throw new RejectBatchError('batch_too_large', `records=${payload.batch.length}`);
    }
    if (logger && parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const unknownKeys = Object.keys(parsed).filter((key) => !KNOWN_ENVELOPE_KEYS.has(key));
        if (unknownKeys.length > 0) {
            logger.warn({ trackEvent: 'unknown_payload_fields', appId: payload.appId, fields: unknownKeys }, 'payload contains fields that are not stored');
        }
    }
    const batchId = payload.batchId;
    const appId = request.appId;
    const env = truncate(payload.env, COLUMN_LIMITS.env) ?? config.trackEnv;
    // ---- 批次级上下文：此前整包丢弃，导致 UA / 页面 / 语言都无法分析 ----
    const context = payload.context;
    const rawUa = readContextString(context, 'userAgent') ?? request.userAgentHeader ?? null;
    const parsedUa = parseUserAgent(rawUa);
    const urlPath = extractPath(readContextString(context, 'url'));
    const referrer = truncate(readContextString(context, 'referrer'), 255);
    const lang = truncate(readContextString(context, 'language'), 16);
    const client = request.client ?? { ip: null, country: null, region: null };
    const rows = [];
    const skipped = {};
    for (const item of payload.batch) {
        const outcome = normalizeRecord(item, {
            batchId,
            appId,
            env,
            sessionId: payload.sessionId,
            userId: payload.userId ?? null,
            receivedAt,
            maxRecordBytes: config.maxRecordBytes,
            country: client.country,
            deviceType: parsedUa.deviceType,
            urlPath,
        });
        if (outcome.ok) {
            rows.push(outcome.row);
        }
        else {
            skipped[outcome.reason] = (skipped[outcome.reason] ?? 0) + 1;
        }
    }
    const rejected = Object.values(skipped).reduce((sum, value) => sum + value, 0);
    if (rows.length === 0) {
        throw new RejectBatchError('all_records_invalid', JSON.stringify(skipped));
    }
    const connection = await db.ingest.getConnection();
    try {
        await connection.beginTransaction();
        const inserted = await insertBatchIfAbsent(connection, {
            batchId,
            appId,
            env,
            recordCount: payload.batch.length,
            receivedAt,
            ip: client.ip,
            country: client.country,
            region: client.region,
            ua: truncate(rawUa, 512),
            deviceType: parsedUa.deviceType,
            os: parsedUa.os,
            browser: parsedUa.browser,
            urlPath,
            referrer,
            lang,
        });
        if (!inserted) {
            await connection.rollback();
            return { status: 'duplicate', batchId, appId, env, accepted: 0, rejected: 0 };
        }
        await bulkInsertEvents(connection, rows);
        await connection.commit();
    }
    catch (error) {
        await connection.rollback().catch(() => undefined);
        throw error;
    }
    finally {
        connection.release();
    }
    return { status: 'accepted', batchId, appId, env, accepted: rows.length, rejected };
}
//# sourceMappingURL=ingest.service.js.map