/**
 * 本地联调用的假接口（不依赖 MySQL）。
 *
 *   node scripts/mock-api.mjs           # 默认 18090
 *   VITE_PROXY_TARGET=http://127.0.0.1:18090 npm run dev
 *
 * 只覆盖看板用到的 5 个只读接口，数据结构与 track-server 保持一致。
 */
import { createServer } from 'node:http';

const PORT = Number(process.env.MOCK_PORT ?? 18090);
const STEP_COUNTS = [1200, 742, 655, 361, 208];
const STEP_EVENTS = ['cashier_view', 'wallet_select', 'wallet_connected', 'pay_click', 'pay_success'];
const OVERVIEW_EVENTS = ['cashier_view', 'wallet_select', 'wallet_connected', 'pay_click', 'pay_success', 'pay_failed'];

const FUNNEL = {
  key: 'cashier_conversion',
  name: '收银台转化',
  appId: 'fylinking-storefront',
  env: 'prod',
  steps: STEP_EVENTS,
  windowMinutes: 30,
};

function json(response, status, body) {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': '*',
    'access-control-allow-headers': '*',
    'cache-control': 'no-store',
  });
  response.end(payload);
}

function buildFunnel(now = Date.now()) {
  const steps = STEP_EVENTS.map((event, index) => {
    const count = STEP_COUNTS[index];
    const previous = index === 0 ? null : STEP_COUNTS[index - 1];
    return {
      index,
      event,
      count,
      rateFromPrevious: previous === null ? null : Number((count / previous).toFixed(4)),
      rateFromStart: index === 0 ? 1 : Number((count / STEP_COUNTS[0]).toFixed(4)),
      dropFromPrevious: previous === null ? null : previous - count,
    };
  });

  return {
    ok: true,
    key: FUNNEL.key,
    name: FUNNEL.name,
    appId: FUNNEL.appId,
    env: 'prod',
    windowMinutes: FUNNEL.windowMinutes,
    from: new Date(now - 6 * 86400_000).toISOString(),
    to: new Date(now).toISOString(),
    walletType: null,
    totalSessions: STEP_COUNTS[0],
    steps,
  };
}

function buildSessions(query, now = Date.now()) {
  const offset = Number(query.get('offset') ?? 0);
  const limit = Number(query.get('limit') ?? 20);
  const stepIndex = Number(query.get('stepIndex') ?? 1);
  const total = 46;
  const sessions = [];
  for (let index = offset; index < Math.min(offset + limit, total); index += 1) {
    const lastStepAt = new Date(now - index * 7 * 60_000).toISOString();
    sessions.push({
      sessionId: `sess_mock_${String(index + 1).padStart(4, '0')}_${Math.random().toString(36).slice(2, 8)}`,
      lastStepAt,
      startedAt: new Date(now - index * 7 * 60_000 - 210_000).toISOString(),
    });
  }
  return {
    ok: true,
    key: FUNNEL.key,
    stepIndex,
    stepEvent: STEP_EVENTS[stepIndex] ?? '',
    sessions,
    hasMore: offset + limit < total,
  };
}

function buildSessionDetail(sessionId, now = Date.now()) {
  const events = [
    { event: 'cashier_view', recordType: 'event', walletType: null, failReason: null, orderId: 'ORD-20261121-001', userId: 'u_10086', occurredAt: new Date(now - 240_000).toISOString(), properties: { payAmount: 199.9, currency: 'USD' } },
    { event: 'wallet_select', recordType: 'event', walletType: 'metamask', failReason: null, orderId: 'ORD-20261121-001', userId: 'u_10086', occurredAt: new Date(now - 200_000).toISOString(), properties: { walletName: 'MetaMask' } },
    { event: 'wallet_connected', recordType: 'event', walletType: 'metamask', failReason: null, orderId: 'ORD-20261121-001', userId: 'u_10086', occurredAt: new Date(now - 160_000).toISOString(), properties: { chainId: '0x1', connectDurationMs: 3200 } },
    { event: 'pay_click', recordType: 'event', walletType: 'metamask', failReason: null, orderId: 'ORD-20261121-001', userId: 'u_10086', occurredAt: new Date(now - 120_000).toISOString(), properties: { payAmount: 199.9, currency: 'USD' } },
    { event: 'pay_failed', recordType: 'event', walletType: 'metamask', failReason: 'user_rejected', orderId: 'ORD-20261121-001', userId: 'u_10086', occurredAt: new Date(now - 90_000).toISOString(), properties: { errorCode: '4001' } },
  ];
  return { ok: true, sessionId, appId: FUNNEL.appId, env: 'prod', tzOffset: '+08:00', events };
}

function buildOverview(now = Date.now()) {
  const points = [];
  for (let dayOffset = 6; dayOffset >= 0; dayOffset -= 1) {
    const bucket = new Date(now - dayOffset * 86400_000).toISOString().slice(0, 10);
    OVERVIEW_EVENTS.forEach((event, index) => {
      const base = [120, 74, 66, 36, 20, 12][index] ?? 10;
      const jitter = 1 + ((dayOffset % 3) - 1) * 0.12;
      points.push({
        bucket,
        event,
        total: Math.round(base * jitter * 10),
        uniqueActors: Math.round(base * jitter * 7),
      });
    });
  }
  return {
    ok: true,
    appId: FUNNEL.appId,
    env: 'prod',
    granularity: 'day',
    tzOffset: '+08:00',
    from: new Date(now - 6 * 86400_000).toISOString(),
    to: new Date(now).toISOString(),
    points,
  };
}

function buildPerformance(now = Date.now()) {
  return {
    ok: true,
    appId: FUNNEL.appId,
    env: 'prod',
    from: new Date(now - 6 * 86400_000).toISOString(),
    to: new Date(now).toISOString(),
    filters: { country: null, deviceType: null, urlPath: null },
    sessions: 486,
    records: 486,
    metrics: [
      { key: 'lcp', unit: 'ms', samples: 486, avg: 2680, p50: 2410, p75: 3260, p95: 5120, max: 7820 },
      { key: 'fcp', unit: 'ms', samples: 486, avg: 1320, p50: 1180, p75: 1680, p95: 2460, max: 3980 },
      { key: 'ttfb', unit: 'ms', samples: 486, avg: 428, p50: 356, p75: 612, p95: 1180, max: 2340 },
      { key: 'load', unit: 'ms', samples: 486, avg: 3120, p50: 2890, p75: 3820, p95: 5760, max: 8420 },
      { key: 'inp', unit: 'ms', samples: 412, avg: 186, p50: 148, p75: 232, p95: 460, max: 880 },
      { key: 'cls', unit: 'score', samples: 486, avg: 0.082, p50: 0.051, p75: 0.112, p95: 0.238, max: 0.412 },
    ],
    byPage: [
      { key: '/pay/1001', samples: 312, avg: 2510, p75: 3120, max: 6980 },
      { key: '/pay/1002', samples: 174, avg: 2980, p75: 3680, max: 7820 },
    ],
    byCountry: [
      { key: 'SG', samples: 182, avg: 1980, p75: 2440, max: 5120 },
      { key: 'HK', samples: 146, avg: 2160, p75: 2680, max: 5460 },
      { key: 'US', samples: 158, avg: 3860, p75: 4620, max: 7820 },
    ],
    byDevice: [
      { key: 'mobile', samples: 328, avg: 3120, p75: 3860, max: 7820 },
      { key: 'desktop', samples: 158, avg: 1860, p75: 2280, max: 4980 },
    ],
  };
}

function buildStay(now = Date.now()) {
  return {
    ok: true,
    appId: FUNNEL.appId,
    env: 'prod',
    from: new Date(now - 6 * 86400_000).toISOString(),
    to: new Date(now).toISOString(),
    filters: { country: null, deviceType: null, urlPath: null },
    samples: 512,
    avgMs: 42300,
    p50: 31200,
    p75: 58400,
    p95: 132000,
    maxMs: 286000,
    byPage: [
      { key: 'https://shop.example.com/pay/1001', samples: 318, avg: 46800, p75: 62400, max: 286000 },
      { key: 'https://shop.example.com/pay/1002', samples: 194, avg: 35200, p75: 48600, max: 158000 },
    ],
    byTrigger: [
      { key: 'pagehide', samples: 372, avg: 44100, p75: 60200, max: 286000 },
      { key: 'route_change', samples: 140, avg: 38600, p75: 51200, max: 142000 },
    ],
  };
}

function buildIntegrity(now = Date.now()) {
  return {
    ok: true,
    appId: FUNNEL.appId,
    env: 'prod',
    from: new Date(now - 6 * 86400_000).toISOString(),
    to: new Date(now).toISOString(),
    batches: 1284,
    expectedRecords: 6420,
    actualRecords: 6420,
    missingRecords: 0,
    mismatchBatches: [],
  };
}

const server = createServer((request, response) => {
  const url = new URL(request.url ?? '/', `http://127.0.0.1:${PORT}`);
  const path = url.pathname;

  if (request.method === 'OPTIONS') {
    response.writeHead(204, {
      'access-control-allow-origin': '*',
      'access-control-allow-headers': '*',
      'access-control-allow-methods': 'GET,POST,OPTIONS',
    });
    response.end();
    return;
  }

  if (path === '/healthz') return json(response, 200, { ok: true, mock: true });
  if (path === '/api/meta/funnels') return json(response, 200, { ok: true, funnels: [FUNNEL] });
  if (path === '/api/funnel') return json(response, 200, buildFunnel());
  if (path === '/api/funnel/sessions') return json(response, 200, buildSessions(url.searchParams));
  if (path.startsWith('/api/funnel/session/')) {
    const sessionId = decodeURIComponent(path.split('/').pop() ?? '');
    return json(response, 200, buildSessionDetail(sessionId));
  }
  if (path === '/api/overview/events') return json(response, 200, buildOverview());
  if (path === '/api/experience/performance') return json(response, 200, buildPerformance());
  if (path === '/api/experience/stay') return json(response, 200, buildStay());
  if (path === '/api/meta/integrity') return json(response, 200, buildIntegrity());

  return json(response, 404, { ok: false, error: 'not_found', path });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[mock-api] listening on http://127.0.0.1:${PORT}`);
  console.log(`[mock-api] 用法：VITE_PROXY_TARGET=http://127.0.0.1:${PORT} npm run dev`);
});
