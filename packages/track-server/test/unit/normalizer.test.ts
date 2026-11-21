import { describe, expect, it } from 'vitest';
import { normalizeRecord, type NormalizeContext } from '../../src/modules/ingest/normalizer.js';

const receivedAt = new Date('2026-11-21T10:00:00.000Z');

function context(overrides: Partial<NormalizeContext> = {}): NormalizeContext {
  return {
    batchId: 'batch_1',
    appId: 'test-app',
    env: 'prod',
    sessionId: 'sess_1',
    userId: 'u_1',
    receivedAt,
    maxRecordBytes: 16384,
    country: 'SG',
    deviceType: 'mobile',
    urlPath: '/pay/1001',
    ...overrides,
  };
}

describe('normalizeRecord', () => {
  it('提取 event 与业务维度', () => {
    const outcome = normalizeRecord(
      {
        type: 'event',
        timestamp: receivedAt.getTime(),
        data: { event: 'pay_click', properties: { orderId: 'o_1', walletType: 'metamask', failReason: 'x' } },
      },
      context(),
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.row.event).toBe('pay_click');
    expect(outcome.row.orderId).toBe('o_1');
    expect(outcome.row.walletType).toBe('metamask');
    expect(outcome.row.failReason).toBe('x');
    expect(outcome.row.recordType).toBe('event');
  });

  it('批次级维度（国家/设备/页面）会写入每条记录', () => {
    const outcome = normalizeRecord(
      { type: 'event', timestamp: receivedAt.getTime(), data: { event: 'cashier_view', properties: {} } },
      context(),
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.row.country).toBe('SG');
    expect(outcome.row.deviceType).toBe('mobile');
    expect(outcome.row.urlPath).toBe('/pay/1001');
  });

  it('缺少维度时写入 null，不写空串', () => {
    const outcome = normalizeRecord(
      { type: 'event', timestamp: receivedAt.getTime(), data: { event: 'cashier_view', properties: {} } },
      context({ country: null, deviceType: null, urlPath: null }),
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.row.country).toBeNull();
    expect(outcome.row.deviceType).toBeNull();
    expect(outcome.row.urlPath).toBeNull();
  });

  it('兼容 snake_case 维度字段', () => {
    const outcome = normalizeRecord(
      { type: 'event', timestamp: receivedAt.getTime(), data: { event: 'pay_success', properties: { wallet_type: 'okx' } } },
      context(),
    );
    expect(outcome.ok && outcome.row.walletType).toBe('okx');
  });

  it('event 类型缺少事件名时跳过该条', () => {
    const outcome = normalizeRecord({ type: 'event', timestamp: Date.now(), data: { properties: {} } }, context());
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe('missing_event_name');
  });

  it('非 event 记录不要求事件名，整体存入 properties', () => {
    const outcome = normalizeRecord(
      { type: 'performance', timestamp: receivedAt.getTime(), data: { stage: 'load', metrics: { lcp: 1234 } } },
      context(),
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.row.event).toBeNull();
    expect(outcome.row.recordType).toBe('performance');
    expect(JSON.parse(outcome.row.properties ?? '{}')).toMatchObject({ stage: 'load' });
  });

  it('超长字段被截断，不会导致整批插入失败', () => {
    const outcome = normalizeRecord(
      {
        type: 'event',
        timestamp: receivedAt.getTime(),
        data: { event: 'e'.repeat(100), properties: { walletType: 'w'.repeat(100) } },
      },
      context(),
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.row.event).toHaveLength(64);
    expect(outcome.row.walletType).toHaveLength(32);
  });

  it('properties 超限时丢弃该条', () => {
    const outcome = normalizeRecord(
      { type: 'event', timestamp: receivedAt.getTime(), data: { event: 'cashier_view', properties: { blob: 'x'.repeat(500) } } },
      context({ maxRecordBytes: 100 }),
    );
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe('properties_too_large');
  });

  it('客户端时间偏差超过 24 小时时回退到服务端时间', () => {
    const outcome = normalizeRecord(
      { type: 'event', timestamp: receivedAt.getTime() - 48 * 3600_000, data: { event: 'cashier_view', properties: {} } },
      context(),
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.row.occurredAt.toISOString()).toBe(receivedAt.toISOString());
  });

  it('结构非法的记录直接跳过', () => {
    expect(normalizeRecord({ type: 'event' }, context()).ok).toBe(false);
    expect(normalizeRecord('not-an-object', context()).ok).toBe(false);
  });
});
