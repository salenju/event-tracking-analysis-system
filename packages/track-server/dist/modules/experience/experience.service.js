import { buildGroupedPercentileSql, buildIntegrityActualSql, buildIntegrityMismatchSql, buildIntegrityTotalsSql, buildPerformanceMetricsSql, buildPerformanceSampleCountSql, buildStaySummarySql, metricMeta, } from './experience.sql.js';
function num(value) {
    if (value === null || value === undefined)
        return null;
    const parsed = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}
function toGroupItems(rows) {
    return rows.map((row) => ({
        key: row.grp_key === null || row.grp_key === undefined ? null : String(row.grp_key),
        samples: num(row.samples) ?? 0,
        avg: num(row.avg_value),
        p75: num(row.p75),
        max: num(row.max_value),
    }));
}
export async function getPerformanceSummary(pool, params) {
    const metricsSql = buildPerformanceMetricsSql(params);
    const countSql = buildPerformanceSampleCountSql(params);
    const byPageSql = buildGroupedPercentileSql({
        ...params,
        recordType: 'performance',
        groupExpr: 'url_path',
        valueExpr: 'lcp_ms',
        limit: 20,
    });
    const byCountrySql = buildGroupedPercentileSql({
        ...params,
        recordType: 'performance',
        groupExpr: 'country',
        valueExpr: 'lcp_ms',
        limit: 20,
    });
    const byDeviceSql = buildGroupedPercentileSql({
        ...params,
        recordType: 'performance',
        groupExpr: 'device_type',
        valueExpr: 'lcp_ms',
        limit: 10,
    });
    const [metricRows, countRows, pageRows, countryRows, deviceRows] = await Promise.all([
        pool.query(metricsSql.sql, metricsSql.params),
        pool.query(countSql.sql, countSql.params),
        pool.query(byPageSql.sql, byPageSql.params),
        pool.query(byCountrySql.sql, byCountrySql.params),
        pool.query(byDeviceSql.sql, byDeviceSql.params),
    ]);
    const byKey = new Map(metricRows.map((row) => [String(row.metric), row]));
    const metrics = metricMeta().map((meta) => {
        const row = byKey.get(meta.key) ?? {};
        return {
            key: meta.key,
            unit: meta.unit,
            samples: num(row.samples) ?? 0,
            avg: num(row.avg_value),
            p50: num(row.p50),
            p75: num(row.p75),
            p95: num(row.p95),
            max: num(row.max_value),
        };
    });
    const countRow = countRows[0] ?? {};
    return {
        sessions: num(countRow.sessions) ?? 0,
        records: num(countRow.records) ?? 0,
        metrics,
        byPage: toGroupItems(pageRows),
        byCountry: toGroupItems(countryRows),
        byDevice: toGroupItems(deviceRows),
    };
}
export async function getStaySummary(pool, params) {
    const summarySql = buildStaySummarySql(params);
    const byPageSql = buildGroupedPercentileSql({
        ...params,
        recordType: 'page_stay',
        groupExpr: "JSON_UNQUOTE(JSON_EXTRACT(properties, '$.page'))",
        valueExpr: 'stay_ms',
        limit: 20,
    });
    const byTriggerSql = buildGroupedPercentileSql({
        ...params,
        recordType: 'page_stay',
        groupExpr: "JSON_UNQUOTE(JSON_EXTRACT(properties, '$.trigger'))",
        valueExpr: 'stay_ms',
        limit: 10,
    });
    const [summaryRows, pageRows, triggerRows] = await Promise.all([
        pool.query(summarySql.sql, summarySql.params),
        pool.query(byPageSql.sql, byPageSql.params),
        pool.query(byTriggerSql.sql, byTriggerSql.params),
    ]);
    const row = summaryRows[0] ?? {};
    return {
        samples: num(row.samples) ?? 0,
        avgMs: num(row.avg_ms),
        p50: num(row.p50),
        p75: num(row.p75),
        p95: num(row.p95),
        maxMs: num(row.max_ms),
        byPage: toGroupItems(pageRows),
        byTrigger: toGroupItems(triggerRows),
    };
}
export async function getIntegrityReport(pool, params) {
    const totalsSql = buildIntegrityTotalsSql(params);
    const actualSql = buildIntegrityActualSql(params);
    const mismatchSql = buildIntegrityMismatchSql(params);
    const [totalsRows, actualRows, mismatchRows] = await Promise.all([
        pool.query(totalsSql.sql, totalsSql.params),
        pool.query(actualSql.sql, actualSql.params),
        pool.query(mismatchSql.sql, mismatchSql.params),
    ]);
    const totals = totalsRows[0] ?? {};
    const expectedRecords = num(totals.expected_records) ?? 0;
    const actualRecords = num(actualRows[0]?.actual_records) ?? 0;
    return {
        batches: num(totals.batches) ?? 0,
        expectedRecords,
        actualRecords,
        missingRecords: Math.max(expectedRecords - actualRecords, 0),
        mismatchBatches: mismatchRows.map((row) => ({
            batchId: String(row.batch_id ?? ''),
            expected: num(row.expected) ?? 0,
            actual: num(row.actual) ?? 0,
        })),
    };
}
//# sourceMappingURL=experience.service.js.map