import { describe, expect, it } from 'vitest';
import {
  buildGroupedPercentileSql,
  buildIntegrityActualSql,
  buildIntegrityMismatchSql,
  buildIntegrityTotalsSql,
  buildPerformanceMetricsSql,
  buildPerformanceSampleCountSql,
  buildStaySummarySql,
  metricMeta,
} from '../../src/modules/experience/experience.sql.js';

const base = {
  appId: 'test-app',
  env: 'prod',
  from: new Date('2026-11-01T00:00:00.000Z'),
  to: new Date('2026-11-08T00:00:00.000Z'),
};

function countPlaceholders(sql: string): number {
  return (sql.match(/\?/g) ?? []).length;
}

describe('experience sql', () => {
  it('指标分位数：6 个指标各带一份 WHERE 参数', () => {
    const { sql, params } = buildPerformanceMetricsSql(base);
    expect(countPlaceholders(sql)).toBe(params.length);
    // 每个指标 5 个条件参数（appId/env/record_type/from/to）
    expect(params).toHaveLength(6 * 5);
    expect(sql).toContain("SELECT 'lcp' AS metric, lcp_ms");
    // MySQL 没有 PERCENTILE_CONT，用 ROW_NUMBER + CEIL(total * p) 定位分位点
    expect(sql).toContain('CEIL(total * 0.5)');
    expect(sql).toContain('CEIL(total * 0.95)');
  });

  it('维度过滤会追加参数且顺序一致', () => {
    const { sql, params } = buildPerformanceMetricsSql({ ...base, country: 'SG', deviceType: 'mobile' });
    expect(countPlaceholders(sql)).toBe(params.length);
    expect(params).toHaveLength(6 * 7);
    expect(params[5]).toBe('SG');
    expect(params[6]).toBe('mobile');
  });

  it('分组分位数：placeholder 与参数对齐，limit 在最后', () => {
    const { sql, params } = buildGroupedPercentileSql({
      ...base,
      country: 'SG',
      recordType: 'performance',
      groupExpr: 'country',
      valueExpr: 'lcp_ms',
      limit: 20,
    });
    expect(countPlaceholders(sql)).toBe(params.length);
    expect(params[params.length - 1]).toBe(20);
    expect(sql).toContain('ORDER BY agg.samples DESC');
    // grp 可能为 NULL，必须用空值安全比较
    expect(sql).toContain('<=>');
  });

  it('停留时长分位数使用 stay_ms', () => {
    const { sql, params } = buildStaySummarySql(base);
    expect(countPlaceholders(sql)).toBe(params.length);
    expect(sql).toContain('stay_ms AS value');
    expect(sql).toContain('CEIL(total * 0.75)');
  });

  it('会话数只统计 stage=final', () => {
    const { sql, params } = buildPerformanceSampleCountSql(base);
    expect(countPlaceholders(sql)).toBe(params.length);
    expect(sql).toContain("perf_stage = 'final'");
  });

  it('完整性检查的三条 SQL 参数数量正确', () => {
    for (const builder of [buildIntegrityTotalsSql, buildIntegrityActualSql, buildIntegrityMismatchSql]) {
      const { sql, params } = builder(base);
      expect(countPlaceholders(sql)).toBe(params.length);
      expect(params).toHaveLength(4);
    }
  });

  it('指标元数据与 SQL 列对应', () => {
    const keys = metricMeta().map((item) => item.key);
    expect(keys).toEqual(['lcp', 'fcp', 'ttfb', 'load', 'inp', 'cls']);
  });
});
