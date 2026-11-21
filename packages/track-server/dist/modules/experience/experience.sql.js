/**
 * 性能与停留时长的聚合 SQL（纯函数，便于单测校验参数顺序）。
 *
 * 指标列来自 migrations/002 的生成列（fcp_ms / lcp_ms / ttfb_ms / load_ms / inp_ms / cls_score / stay_ms），
 * 查询侧不必再解析 properties。
 *
 * MySQL 没有 PERCENTILE_CONT，用窗口函数取第 N 个值：
 *   ROW_NUMBER() + CEIL(total * p) 定位分位点，再按分组取回。
 */
const RECORD_TYPE_PERFORMANCE = 'performance';
const RECORD_TYPE_PAGE_STAY = 'page_stay';
/** 通用 WHERE 构造，参数顺序与 SQL 文本严格一致 */
function buildWhere(query, recordType) {
    const conditions = ['app_id = ?', 'env = ?', 'record_type = ?', 'occurred_at >= ?', 'occurred_at < ?'];
    const params = [query.appId, query.env, recordType, query.from, query.to];
    if (query.country) {
        conditions.push('country = ?');
        params.push(query.country);
    }
    if (query.deviceType) {
        conditions.push('device_type = ?');
        params.push(query.deviceType);
    }
    if (query.urlPath) {
        conditions.push('url_path = ?');
        params.push(query.urlPath);
    }
    return { sql: conditions.join(' AND '), params };
}
const METRICS = [
    { key: 'lcp', column: 'lcp_ms', unit: 'ms' },
    { key: 'fcp', column: 'fcp_ms', unit: 'ms' },
    { key: 'ttfb', column: 'ttfb_ms', unit: 'ms' },
    { key: 'load', column: 'load_ms', unit: 'ms' },
    { key: 'inp', column: 'inp_ms', unit: 'ms' },
    { key: 'cls', column: 'cls_score', unit: 'score' },
];
export function metricMeta() {
    return METRICS.map((item) => ({ key: item.key, unit: item.unit }));
}
/** 各指标的分位数，一次查询返回每个指标一行 */
export function buildPerformanceMetricsSql(query) {
    const where = buildWhere(query, RECORD_TYPE_PERFORMANCE);
    const unions = METRICS.map((metric) => {
        return `SELECT '${metric.key}' AS metric, ${metric.column} AS value FROM events WHERE ${where.sql}`;
    }).join('\n  UNION ALL\n  ');
    const sql = `WITH raw AS (
  ${unions}
), ranked AS (
  SELECT metric, value,
         ROW_NUMBER() OVER (PARTITION BY metric ORDER BY value) AS rn,
         COUNT(*) OVER (PARTITION BY metric) AS total
    FROM raw
   WHERE value IS NOT NULL AND value >= 0
)
SELECT metric,
       total AS samples,
       ROUND(AVG(value), 2) AS avg_value,
       MAX(value) AS max_value,
       MAX(CASE WHEN rn = GREATEST(1, CEIL(total * 0.5))  THEN value END) AS p50,
       MAX(CASE WHEN rn = GREATEST(1, CEIL(total * 0.75)) THEN value END) AS p75,
       MAX(CASE WHEN rn = GREATEST(1, CEIL(total * 0.95)) THEN value END) AS p95
  FROM ranked
 GROUP BY metric, total`;
    // 每个 UNION 分支各带一份 WHERE 参数
    const params = METRICS.flatMap(() => where.params);
    return { sql, params };
}
/** 按任意维度分组的分位数（用于「按页面」「按国家」「按触发时机」） */
export function buildGroupedPercentileSql(query) {
    const where = buildWhere(query, query.recordType);
    const params = [...where.params];
    const sql = `WITH raw AS (
  SELECT ${query.groupExpr} AS grp, ${query.valueExpr} AS value
    FROM events
   WHERE ${where.sql}
), ranked AS (
  SELECT grp, value,
         ROW_NUMBER() OVER (PARTITION BY grp ORDER BY value) AS rn,
         COUNT(*) OVER (PARTITION BY grp) AS total
    FROM raw
   WHERE value IS NOT NULL AND value >= 0
), agg AS (
  SELECT grp AS grp_key, COUNT(*) AS samples, ROUND(AVG(value), 1) AS avg_value, MAX(value) AS max_value
    FROM ranked GROUP BY grp
), pct AS (
  SELECT grp AS grp_key,
         MAX(CASE WHEN rn = GREATEST(1, CEIL(total * 0.75)) THEN value END) AS p75
    FROM ranked GROUP BY grp
)
SELECT agg.grp_key, agg.samples, agg.avg_value, agg.max_value, pct.p75
  FROM agg
  LEFT JOIN pct ON pct.grp_key <=> agg.grp_key
 ORDER BY agg.samples DESC
 LIMIT ?`;
    params.push(query.limit);
    return { sql, params };
}
/** 性能会话数：以 stage=final 的批次数近似「被观测的会话数」 */
export function buildPerformanceSampleCountSql(query) {
    const where = buildWhere(query, RECORD_TYPE_PERFORMANCE);
    const sql = `SELECT COUNT(DISTINCT session_id) AS sessions, COUNT(*) AS records
    FROM events
   WHERE ${where.sql} AND perf_stage = 'final'`;
    return { sql, params: where.params };
}
/** 停留时长整体分位数 */
export function buildStaySummarySql(query) {
    const where = buildWhere(query, RECORD_TYPE_PAGE_STAY);
    const sql = `WITH raw AS (
  SELECT stay_ms AS value FROM events WHERE ${where.sql}
), ranked AS (
  SELECT value,
         ROW_NUMBER() OVER (ORDER BY value) AS rn,
         COUNT(*) OVER () AS total
    FROM raw
   WHERE value IS NOT NULL AND value >= 0
)
-- total 来自窗口函数，在聚合查询里必须包一层，否则 only_full_group_by 报错
SELECT MAX(total) AS samples,
       ROUND(AVG(value), 0) AS avg_ms,
       MAX(value) AS max_ms,
       MAX(CASE WHEN rn = GREATEST(1, CEIL(total * 0.5))  THEN value END) AS p50,
       MAX(CASE WHEN rn = GREATEST(1, CEIL(total * 0.75)) THEN value END) AS p75,
       MAX(CASE WHEN rn = GREATEST(1, CEIL(total * 0.95)) THEN value END) AS p95
  FROM ranked`;
    return { sql, params: where.params };
}
/** 数据完整性：批次声明条数 vs 实际入库条数 */
export function buildIntegrityTotalsSql(query) {
    const sql = `SELECT COUNT(*) AS batches, COALESCE(SUM(record_count), 0) AS expected_records
    FROM event_batches
   WHERE app_id = ? AND env = ? AND received_at >= ? AND received_at < ?`;
    return { sql, params: [query.appId, query.env, query.from, query.to] };
}
export function buildIntegrityActualSql(query) {
    const sql = `SELECT COUNT(*) AS actual_records
    FROM events
   WHERE app_id = ? AND env = ? AND received_at >= ? AND received_at < ?`;
    return { sql, params: [query.appId, query.env, query.from, query.to] };
}
/** 个别批次缺行（有记录被跳过或写入中断），用于排查静默丢数据 */
export function buildIntegrityMismatchSql(query) {
    const sql = `SELECT b.batch_id, b.record_count AS expected, COUNT(e.id) AS actual
    FROM event_batches b
    LEFT JOIN events e ON e.batch_id = b.batch_id
   WHERE b.app_id = ? AND b.env = ? AND b.received_at >= ? AND b.received_at < ?
   GROUP BY b.batch_id, b.record_count
  HAVING actual <> b.record_count
   ORDER BY b.batch_id DESC
   LIMIT 20`;
    return { sql, params: [query.appId, query.env, query.from, query.to] };
}
//# sourceMappingURL=experience.sql.js.map