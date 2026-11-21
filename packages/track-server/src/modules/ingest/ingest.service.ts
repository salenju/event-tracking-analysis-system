import type { AppConfig } from '../../config/index.js';
import { COLUMN_LIMITS } from '../../domain/events.js';
import { RejectBatchError } from '../../domain/errors.js';
import type { Db } from '../../lib/db.js';
import type { ClientGeo } from '../../lib/geo.js';
import type { Logger } from '../../lib/logger.js';
import { extractPath, parseUserAgent } from '../../lib/ua.js';
import { insertBatchIfAbsent } from '../../repositories/batch.repo.js';
import { bulkInsertEvents } from '../../repositories/event.repo.js';
import { normalizeRecord, truncate, type EventRow } from './normalizer.js';
import { envelopeSchema } from './payload.schema.js';

export interface IngestDeps {
  config: AppConfig;
  db: Db;
  logger?: Logger;
}

export interface IngestRequest {
  rawBody: string;
  /** 已通过验签的 appId（来自请求头或 query，脚本标签接入走 query） */
  appId: string;
  /** query 上的 env（脚本标签接入时 env 随 serverUrl 传递），优先级低于报文里的 env */
  envHint?: string | null;
  receivedAt?: Date;
  /** 网关透传的 IP / 国家 / 地区 */
  client?: ClientGeo;
  /** 请求头里的 UA，作为 payload.context.userAgent 的兜底 */
  userAgentHeader?: string | null;
}

export interface IngestResult {
  status: 'accepted' | 'duplicate';
  batchId: string;
  appId: string;
  env: string;
  accepted: number;
  rejected: number;
}

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

function readContextString(context: Record<string, unknown>, key: string): string | null {
  const value = context[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * 埋点入库主流程。
 * 抛出 RejectBatchError 表示"客户端应视为成功、但数据不入库"（由路由层转 200 + 日志）；
 * 其他异常（DB 故障等）由错误处理器转 503，交给 SDK 重试。
 */
export async function ingestBatch(deps: IngestDeps, request: IngestRequest): Promise<IngestResult> {
  const { config, db, logger } = deps;
  const receivedAt = request.receivedAt ?? new Date();

  let parsed: unknown;
  try {
    parsed = JSON.parse(request.rawBody);
  } catch {
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

  // 脚本标签接入时报文里没有 appId，只认验签结果；有值时仍必须一致，防止串号
  if (payload.appId && payload.appId !== request.appId) {
    throw new RejectBatchError('app_id_mismatch', `header=${request.appId} body=${payload.appId}`);
  }
  if (payload.batch.length > config.maxRecordsPerBatch) {
    throw new RejectBatchError('batch_too_large', `records=${payload.batch.length}`);
  }

  if (logger && parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const unknownKeys = Object.keys(parsed as Record<string, unknown>).filter(
      (key) => !KNOWN_ENVELOPE_KEYS.has(key),
    );
    if (unknownKeys.length > 0) {
      logger.warn(
        { trackEvent: 'unknown_payload_fields', appId: payload.appId, fields: unknownKeys },
        'payload contains fields that are not stored',
      );
    }
  }

  const batchId = payload.batchId;
  const appId = request.appId;
  // 优先级：报文 env（SDK 构建期注入）> query env（脚本标签接入）> 服务端默认
  const env = truncate(payload.env, COLUMN_LIMITS.env) ?? truncate(request.envHint, COLUMN_LIMITS.env) ?? config.trackEnv;

  // ---- 批次级上下文：此前整包丢弃，导致 UA / 页面 / 语言都无法分析 ----
  const context = payload.context as Record<string, unknown>;
  const rawUa = readContextString(context, 'userAgent') ?? request.userAgentHeader ?? null;
  const parsedUa = parseUserAgent(rawUa);
  const urlPath = extractPath(readContextString(context, 'url'));
  const referrer = truncate(readContextString(context, 'referrer'), 255);
  const lang = truncate(readContextString(context, 'language'), 16);
  const client = request.client ?? { ip: null, country: null, region: null };

  const rows: EventRow[] = [];
  const skipped: Record<string, number> = {};
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
    } else {
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
  } catch (error) {
    await connection.rollback().catch(() => undefined);
    throw error;
  } finally {
    connection.release();
  }

  return { status: 'accepted', batchId, appId, env, accepted: rows.length, rejected };
}
