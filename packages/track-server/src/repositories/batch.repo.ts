import { isDuplicateKeyError } from '../domain/errors.js';
import type { DbConnection } from '../lib/db.js';

export interface BatchRow {
  batchId: string;
  appId: string;
  env: string;
  recordCount: number;
  receivedAt: Date;
}

/**
 * 幂等写入：主键冲突返回 false（重复批次）。
 * 必须与 events 插入在同一事务里，否则会出现"幂等表已写、事件未写"的永久丢失。
 */
export async function insertBatchIfAbsent(connection: DbConnection, row: BatchRow): Promise<boolean> {
  try {
    await connection.query(
      `INSERT INTO event_batches (batch_id, app_id, env, record_count, received_at)
       VALUES (?, ?, ?, ?, ?)`,
      [row.batchId, row.appId, row.env, row.recordCount, row.receivedAt],
    );
    return true;
  } catch (error) {
    if (isDuplicateKeyError(error)) return false;
    throw error;
  }
}
