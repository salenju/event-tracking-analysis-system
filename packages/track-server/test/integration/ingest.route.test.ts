import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config/index.js';
import { signPayload } from '../../src/lib/signature.js';
import type { FunnelDef } from '../../src/modules/funnel/funnel.config.js';
import { FakeDb } from '../fixtures/fake-db.js';

const APP_ID = 'test-app';
const SECRET = 'test-secret';

const config = loadConfig({
  NODE_ENV: 'test',
  APP_SECRETS: JSON.stringify({ [APP_ID]: SECRET }),
  TRACK_ENV: 'test',
  LOG_LEVEL: 'silent',
} as unknown as NodeJS.ProcessEnv);

const funnels: FunnelDef[] = [
  {
    key: 'cashier',
    name: '收银台',
    appId: APP_ID,
    env: 'test',
    steps: ['cashier_view', 'pay_click'],
    windowMinutes: 30,
  },
];

function makePayload(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    appId: APP_ID,
    sdkVersion: '2.1.1',
    userId: 'u_1',
    sessionId: 'sess_1',
    batchId: `batch_${Math.random().toString(36).slice(2, 10)}`,
    sentAt: Date.now(),
    env: 'test',
    context: { url: 'https://example.com/pay/1', userAgent: 'vitest' },
    batch: [
      {
        type: 'event',
        timestamp: Date.now(),
        data: { event: 'cashier_view', properties: { orderId: 'o_1', walletType: 'metamask' } },
      },
      {
        type: 'performance',
        timestamp: Date.now(),
        data: { stage: 'load', metrics: { lcp: 1200 } },
      },
    ],
    ...overrides,
  });
}

function signedRequest(body: string, options: { appId?: string; secret?: string; sentAt?: number } = {}) {
  const appId = options.appId ?? APP_ID;
  const sentAt = options.sentAt ?? Date.now();
  return {
    method: 'POST' as const,
    url: '/api/track',
    payload: body,
    headers: {
      'content-type': 'text/plain;charset=UTF-8',
      'x-track-app-id': appId,
      'x-track-sent-at': String(sentAt),
      'x-track-sign': signPayload(appId, sentAt, body, options.secret ?? SECRET),
    },
  };
}

describe('POST /api/track', () => {
  let app: FastifyInstance;
  let db: FakeDb;

  beforeEach(async () => {
    db = new FakeDb();
    app = await buildApp({ config, db, funnels, logger: false });
  });

  afterEach(async () => {
    await app.close();
  });

  it('正常入库：event 与 performance 都落库', async () => {
    const body = makePayload();
    const response = await app.inject(signedRequest(body));

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ ok: true, accepted: 2, rejected: 0 });
    expect(db.batches).toHaveLength(1);
    expect(db.events).toHaveLength(2);
    expect(db.events.map((row) => row.recordType).sort()).toEqual(['event', 'performance']);
    expect(db.events[0]?.walletType).toBe('metamask');
    expect(db.events[0]?.orderId).toBe('o_1');
  });

  it('重复批次返回 200 且不重复入库', async () => {
    const body = makePayload({ batchId: 'batch_fixed' });
    await app.inject(signedRequest(body));
    const second = await app.inject(signedRequest(body));

    expect(second.statusCode).toBe(200);
    expect(second.json()).toMatchObject({ ok: true, duplicate: true, accepted: 0 });
    expect(db.batches).toHaveLength(1);
    expect(db.events).toHaveLength(2);
  });

  it('签名错误：返回 200（避免 SDK 无限重试）但拒绝入库', async () => {
    const response = await app.inject(signedRequest(makePayload(), { secret: 'wrong-secret' }));

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ ok: true, accepted: 0, reason: 'invalid_signature' });
    expect(db.events).toHaveLength(0);
  });

  it('缺少签名头：返回 200 + missing_signature', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/track',
      payload: makePayload(),
      headers: { 'content-type': 'text/plain;charset=UTF-8', 'x-track-app-id': APP_ID },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ reason: 'missing_signature' });
  });

  it('未授权 appId：返回 200 + unknown_app_id', async () => {
    const response = await app.inject(signedRequest(makePayload({ appId: 'other-app' }), { appId: 'other-app' }));

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ reason: 'unknown_app_id' });
    expect(db.batches).toHaveLength(0);
  });

  it('时间窗过期：返回 200 + stale_request', async () => {
    const response = await app.inject(signedRequest(makePayload(), { sentAt: Date.now() - 3600_000 }));

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ reason: 'stale_request' });
  });

  it('非法 JSON：返回 200 + invalid_json', async () => {
    const response = await app.inject(signedRequest('{not-json'));

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ reason: 'invalid_json' });
  });

  it('单条记录非法只跳过该条，不影响同批其他事件', async () => {
    const body = makePayload({
      batch: [
        { type: 'event', timestamp: Date.now(), data: { event: 'cashier_view', properties: {} } },
        { type: 'event', timestamp: Date.now(), data: { properties: {} } },
      ],
    });
    const response = await app.inject(signedRequest(body));

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ ok: true, accepted: 1, rejected: 1 });
    expect(db.events).toHaveLength(1);
  });

  it('记录数超过上限：返回 200 + batch_too_large', async () => {
    const batch = Array.from({ length: config.maxRecordsPerBatch + 1 }, () => ({
      type: 'event',
      timestamp: Date.now(),
      data: { event: 'cashier_view', properties: {} },
    }));
    const response = await app.inject(signedRequest(makePayload({ batch })));

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ reason: 'batch_too_large' });
  });

  it('body 超限：返回 200 + body_too_large', async () => {
    const huge = makePayload({ padding: 'x'.repeat(config.bodyLimitBytes + 1024) });
    const response = await app.inject(signedRequest(huge));

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ reason: 'body_too_large' });
  });

  it('DB 故障返回 503，让 SDK 重试', async () => {
    db.failOnInsertEvents = true;
    const response = await app.inject(signedRequest(makePayload()));

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ ok: false, error: 'unavailable' });
  });

  it('beacon 降级：签名可通过 query 传递', async () => {
    const body = makePayload();
    const sentAt = Date.now();
    const sign = signPayload(APP_ID, sentAt, body, SECRET);

    const response = await app.inject({
      method: 'POST',
      url: `/api/track?appId=${APP_ID}&sentAt=${sentAt}&sign=${sign}`,
      payload: body,
      headers: { 'content-type': 'text/plain;charset=UTF-8' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ ok: true, accepted: 2 });
  });

  it('健康检查可用', async () => {
    const response = await app.inject({ method: 'GET', url: '/healthz' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ ok: true });
  });
});
