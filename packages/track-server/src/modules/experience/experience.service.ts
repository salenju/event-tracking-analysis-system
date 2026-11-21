import type { DbPool } from '../../lib/db.js';
import {
  buildGroupedPercentileSql,
  buildIntegrityActualSql,
  buildIntegrityMismatchSql,
  buildIntegrityTotalsSql,
  buildPerformanceMetricsSql,
  buildPerformanceSampleCountSql,
  buildStaySummarySql,
  metricMeta,
  type ExperienceQuery,
} from './experience.sql.js';

export interface ExperienceParams extends ExperienceQuery {}

export interface MetricResult {
  key: string;
  unit: 'ms' | 'score';
  samples: number;
  avg: number | null;
  p50: number | null;
  p75: number | null;
  p95: number | null;
  max: number | null;
}

export interface GroupItem {
  key: string | null;
  samples: number;
  avg: number | null;
  p75: number | null;
  max: number | null;
}

export interface PerformanceSummary {
  sessions: number;
  records: number;
  metrics: MetricResult[];
  byPage: GroupItem[];
  byCountry: GroupItem[];
  byDevice: GroupItem[];
}

export interface StaySummary {
  samples: number;
  avgMs: number | null;
  p50: number | null;
  p75: number | null;
  p95: number | null;
  maxMs: number | null;
  byPage: GroupItem[];
  byTrigger: GroupItem[];
}

export interface IntegrityReport {
  batches: number;
  expectedRecords: number;
  actualRecords: number;
  missingRecords: number;
  mismatchBatches: Array<{ batchId: string; expected: number; actual: number }>;
}

function num(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toGroupItems(rows: Array<Record<string, unknown>>): GroupItem[] {
  return rows.map((row) => ({
    key: row.grp_key === null || row.grp_key === undefined ? null : String(row.grp_key),
    samples: num(row.samples) ?? 0,
    avg: num(row.avg_value),
    p75: num(row.p75),
    max: num(row.max_value),
  }));
}

export async function getPerformanceSummary(
  pool: DbPool,
  params: ExperienceParams,
): Promise<PerformanceSummary> {
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
    pool.query<Record<string, unknown>>(metricsSql.sql, metricsSql.params),
    pool.query<Record<string, unknown>>(countSql.sql, countSql.params),
    pool.query<Record<string, unknown>>(byPageSql.sql, byPageSql.params),
    pool.query<Record<string, unknown>>(byCountrySql.sql, byCountrySql.params),
    pool.query<Record<string, unknown>>(byDeviceSql.sql, byDeviceSql.params),
  ]);

  const byKey = new Map(metricRows.map((row) => [String(row.metric), row]));
  const metrics: MetricResult[] = metricMeta().map((meta) => {
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

export async function getStaySummary(pool: DbPool, params: ExperienceParams): Promise<StaySummary> {
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
    pool.query<Record<string, unknown>>(summarySql.sql, summarySql.params),
    pool.query<Record<string, unknown>>(byPageSql.sql, byPageSql.params),
    pool.query<Record<string, unknown>>(byTriggerSql.sql, byTriggerSql.params),
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

export async function getIntegrityReport(
  pool: DbPool,
  params: ExperienceParams,
): Promise<IntegrityReport> {
  const totalsSql = buildIntegrityTotalsSql(params);
  const actualSql = buildIntegrityActualSql(params);
  const mismatchSql = buildIntegrityMismatchSql(params);

  const [totalsRows, actualRows, mismatchRows] = await Promise.all([
    pool.query<Record<string, unknown>>(totalsSql.sql, totalsSql.params),
    pool.query<Record<string, unknown>>(actualSql.sql, actualSql.params),
    pool.query<Record<string, unknown>>(mismatchSql.sql, mismatchSql.params),
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
