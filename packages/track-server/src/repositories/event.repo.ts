import type { DbConnection, DbPool } from '../lib/db.js';
import type { EventRow } from '../modules/ingest/normalizer.js';

const INSERT_COLUMNS = 16;

/** 单条 multi-row INSERT，避免逐行往返；由调用方保证在事务内执行 */
export async function bulkInsertEvents(connection: DbConnection, rows: EventRow[]): Promise<void> {
  if (rows.length === 0) return;
  const placeholders = rows.map(() => `(${new Array(INSERT_COLUMNS).fill('?').join(',')})`).join(',');
  const params: unknown[] = [];
  for (const row of rows) {
    params.push(
      row.batchId,
      row.appId,
      row.env,
      row.country,
      row.deviceType,
      row.urlPath,
      row.recordType,
      row.event,
      row.userId,
      row.sessionId,
      row.orderId,
      row.walletType,
      row.failReason,
      row.properties,
      row.occurredAt,
      row.receivedAt,
    );
  }
  await connection.query(
    `INSERT INTO events
       (batch_id, app_id, env, country, device_type, url_path, record_type, \`event\`,
        user_id, session_id, order_id, wallet_type, fail_reason, properties, occurred_at, received_at)
     VALUES ${placeholders}`,
    params,
  );
}

export interface SessionEventRow {
  event: string | null;
  recordType: string;
  walletType: string | null;
  failReason: string | null;
  orderId: string | null;
  userId: string | null;
  properties: string | null;
  occurredAt: Date;
}

export async function findSessionTimeline(
  pool: DbPool,
  params: { sessionId: string; appId: string; env: string; limit: number },
): Promise<SessionEventRow[]> {
  const rows = await pool.query<Record<string, unknown>>(
    `SELECT /*+ MAX_EXECUTION_TIME(5000) */
            \`event\`, record_type, wallet_type, fail_reason, order_id, user_id, properties, occurred_at
       FROM events
      WHERE session_id = ? AND app_id = ? AND env = ?
      ORDER BY occurred_at ASC, id ASC
      LIMIT ?`,
    [params.sessionId, params.appId, params.env, params.limit],
  );
  return rows.map((row) => ({
    event: (row.event as string | null) ?? null,
    recordType: String(row.record_type ?? ''),
    walletType: (row.wallet_type as string | null) ?? null,
    failReason: (row.fail_reason as string | null) ?? null,
    orderId: (row.order_id as string | null) ?? null,
    userId: (row.user_id as string | null) ?? null,
    properties: (row.properties as string | null) ?? null,
    occurredAt: row.occurred_at as Date,
  }));
}
