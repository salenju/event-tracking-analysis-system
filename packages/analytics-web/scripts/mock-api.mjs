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

  return json(response, 404, { ok: false, error: 'not_found', path });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[mock-api] listening on http://127.0.0.1:${PORT}`);
  console.log(`[mock-api] 用法：VITE_PROXY_TARGET=http://127.0.0.1:${PORT} npm run dev`);
});
