import { describe, expect, it } from 'vitest';
import {
  buildDropOffSessionsSql,
  buildFunnelSql,
  buildOverviewSql,
  buildSessionStepTimesSql,
} from '../../src/modules/funnel/funnel.sql.js';

const steps = ['cashier_view', 'wallet_select', 'wallet_connected', 'pay_click', 'pay_success'];
const base = {
  steps,
  appId: 'test-app',
  env: 'prod',
  from: new Date('2026-11-01T00:00:00.000Z'),
  to: new Date('2026-11-08T00:00:00.000Z'),
  windowMinutes: 30,
  maxExecutionMs: 5000,
};

function countPlaceholders(sql: string): number {
  return (sql.match(/\?/g) ?? []).length;
}

describe('funnel sql', () => {
  it('步骤时间子查询：占位符与参数数量一致', () => {
    const { sql, params } = buildSessionStepTimesSql(base);
    expect(countPlaceholders(sql)).toBe(params.length);
    // 5 个步骤名 + appId/env/from/to + IN 列表 5 个
    expect(params).toHaveLength(5 + 4 + 5);
  });

  it('带钱包筛选时，首步不加钱包条件（收银台还没有钱包）', () => {
    const { sql, params } = buildSessionStepTimesSql({ ...base, walletType: 'metamask' });
    expect(countPlaceholders(sql)).toBe(params.length);
    // 首步 1 个 event 参数，其余 4 步各 2 个（event + wallet_type），再加 appId/env/from/to 与 IN 列表
    expect(params).toHaveLength(9 + 4 + 5);
    expect(sql).toContain('MIN(IF(`event` = ?, occurred_at, NULL)) AS t0');
    expect(sql).toContain('MIN(IF(`event` = ? AND wallet_type = ?, occurred_at, NULL)) AS t1');
  });

  it('聚合 SQL：窗口参数在前（SELECT 列表先于 FROM 子查询）', () => {
    const { sql, params } = buildFunnelSql(base);
    expect(countPlaceholders(sql)).toBe(params.length);
    // 4 个窗口条件 + 子查询参数
    expect(params[0]).toBe(30 * 60);
    expect(params.slice(0, 4)).toEqual([1800, 1800, 1800, 1800]);
    expect(params[4]).toBe('cashier_view');
    expect(sql).toContain('COUNT(*) AS step_0');
    expect(sql).toContain('WHERE t0 IS NOT NULL');
    expect(sql).toContain('MAX_EXECUTION_TIME(5000)');
  });

  it('流失会话 SQL：子查询参数在前，窗口与 limit 在后', () => {
    const { sql, params } = buildDropOffSessionsSql({ ...base, stepIndex: 2, limit: 21 });
    expect(countPlaceholders(sql)).toBe(params.length);
    expect(params[params.length - 2]).toBe(1800);
    expect(params[params.length - 1]).toBe(21);
    expect(sql).toContain('t2 IS NULL');
  });

  it('概览 SQL：按小时/按天使用不同 bucket 格式', () => {
    const day = buildOverviewSql({
      appId: 'test-app',
      env: 'prod',
      from: base.from,
      to: base.to,
      tzOffset: '+08:00',
      granularity: 'day',
      limit: 100,
    });
    expect(countPlaceholders(day.sql)).toBe(day.params.length);
    expect(day.sql).toContain('%Y-%m-%d');
    expect(day.params[0]).toBe('+08:00');

    const hour = buildOverviewSql({
      appId: 'test-app',
      env: 'prod',
      from: base.from,
      to: base.to,
      tzOffset: '+08:00',
      granularity: 'hour',
      events: ['pay_success'],
      limit: 100,
    });
    expect(countPlaceholders(hour.sql)).toBe(hour.params.length);
    expect(hour.sql).toContain('%Y-%m-%d %H:00:00');
  });
});
