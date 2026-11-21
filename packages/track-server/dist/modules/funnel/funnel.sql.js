/**
 * 漏斗 SQL 构造（纯函数，便于单测校验参数顺序）。
 *
 * 口径（架构文档 7.3）：
 * - 主体是 session_id，同一步骤重复触发只算一次（MIN 取首次）
 * - 相邻步骤按 occurred_at 升序且间隔不超过 windowMinutes
 * - 只统计 record_type='event' 的记录
 *
 * ⚠️ 参数顺序必须与 SQL 文本中 ? 出现顺序严格一致：
 *    SELECT 列表（聚合条件）→ FROM 子查询（步骤条件）→ WHERE → LIMIT
 */
/** 每个 session 各步骤的首次发生时间 t0..tn */
export function buildSessionStepTimesSql(query) {
    const selectParts = ['session_id'];
    const params = [];
    query.steps.forEach((step, index) => {
        let condition = '`event` = ?';
        params.push(step);
        // 钱包维度只对第二步及之后生效：首步 cashier_view 时还没有钱包
        if (index > 0 && query.walletType) {
            condition += ' AND wallet_type = ?';
            params.push(query.walletType);
        }
        selectParts.push(`MIN(IF(${condition}, occurred_at, NULL)) AS t${index}`);
    });
    const inList = query.steps.map(() => '?').join(',');
    const sql = `SELECT ${selectParts.join(', ')}
      FROM events
     WHERE app_id = ? AND env = ? AND record_type = 'event'
       AND occurred_at >= ? AND occurred_at < ?
       AND \`event\` IN (${inList})
     GROUP BY session_id`;
    params.push(query.appId, query.env, query.from, query.to, ...query.steps);
    return { sql, params };
}
export function buildFunnelSql(query) {
    const inner = buildSessionStepTimesSql(query);
    const seconds = query.windowMinutes * 60;
    const params = [];
    const aggregates = [];
    for (let index = 1; index < query.steps.length; index += 1) {
        params.push(seconds);
        aggregates.push(`SUM(CASE WHEN t${index} IS NOT NULL AND t${index - 1} IS NOT NULL
                 AND t${index} >= t${index - 1}
                 AND TIMESTAMPDIFF(SECOND, t${index - 1}, t${index}) <= ?
           THEN 1 ELSE 0 END) AS step_${index}`);
    }
    const hint = Math.max(1, Math.floor(query.maxExecutionMs));
    const sql = `SELECT /*+ MAX_EXECUTION_TIME(${hint}) */
         COUNT(*) AS step_0${aggregates.length ? `, ${aggregates.join(', ')}` : ''}
    FROM (${inner.sql}) t
   WHERE t0 IS NOT NULL`;
    return { sql, params: [...params, ...inner.params] };
}
export function buildDropOffSessionsSql(query) {
    const inner = buildSessionStepTimesSql(query);
    const seconds = query.windowMinutes * 60;
    const current = `t${query.stepIndex - 1}`;
    const next = `t${query.stepIndex}`;
    const hint = Math.max(1, Math.floor(query.maxExecutionMs));
    // 这里子查询位于 FROM，先于 WHERE 出现，所以子查询参数在前
    const sql = `SELECT /*+ MAX_EXECUTION_TIME(${hint}) */
         session_id, ${current} AS last_step_at, t0 AS started_at
    FROM (${inner.sql}) t
   WHERE ${current} IS NOT NULL
     AND (${next} IS NULL
          OR ${next} < ${current}
          OR TIMESTAMPDIFF(SECOND, ${current}, ${next}) > ?)
   ORDER BY ${current} DESC
   LIMIT ?`;
    return { sql, params: [...inner.params, seconds, query.limit] };
}
export function buildOverviewSql(query) {
    const tzFormat = query.granularity === 'hour' ? '%Y-%m-%d %H:00:00' : '%Y-%m-%d';
    const bucket = `DATE_FORMAT(CONVERT_TZ(occurred_at, '+00:00', ?), '${tzFormat}')`;
    const params = [query.tzOffset, query.appId, query.env, query.from, query.to];
    let eventFilter = '';
    if (query.events && query.events.length > 0) {
        eventFilter = `AND \`event\` IN (${query.events.map(() => '?').join(',')})`;
        params.push(...query.events);
    }
    const hint = 5000;
    const sql = `SELECT /*+ MAX_EXECUTION_TIME(${hint}) */
         ${bucket} AS bucket,
         \`event\`,
         COUNT(*) AS total,
         COUNT(DISTINCT COALESCE(user_id, session_id)) AS unique_actors
    FROM events
   WHERE app_id = ? AND env = ? AND record_type = 'event' AND \`event\` IS NOT NULL
     AND occurred_at >= ? AND occurred_at < ?
     ${eventFilter}
   GROUP BY bucket, \`event\`
   ORDER BY bucket ASC, total DESC
   LIMIT ?`;
    params.push(query.limit);
    return { sql, params };
}
//# sourceMappingURL=funnel.sql.js.map