import { isDuplicateKeyError } from '../domain/errors.js';
/**
 * 幂等写入：主键冲突返回 false（重复批次）。
 * 必须与 events 插入在同一事务里，否则会出现"幂等表已写、事件未写"的永久丢失。
 */
export async function insertBatchIfAbsent(connection, row) {
    try {
        await connection.query(`INSERT INTO event_batches
         (batch_id, app_id, env, record_count, received_at,
          ip, country, region, ua, device_type, os, browser, url_path, referrer, lang)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
            row.batchId,
            row.appId,
            row.env,
            row.recordCount,
            row.receivedAt,
            row.ip ?? null,
            row.country ?? null,
            row.region ?? null,
            row.ua ?? null,
            row.deviceType ?? null,
            row.os ?? null,
            row.browser ?? null,
            row.urlPath ?? null,
            row.referrer ?? null,
            row.lang ?? null,
        ]);
        return true;
    }
    catch (error) {
        if (isDuplicateKeyError(error))
            return false;
        throw error;
    }
}
//# sourceMappingURL=batch.repo.js.map