import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config/index.js';
import { signPayload } from '../../src/lib/signature.js';
import type { FeishuGateway } from '../../src/modules/auth/feishu.client.js';
import type { FunnelDef } from '../../src/modules/funnel/funnel.config.js';
import { FakeDb } from '../fixtures/fake-db.js';
import {
  MemoryAdminUserStore,
  MemoryAppStore,
  MemoryLoginStateStore,
  MemorySessionStore,
} from '../fixtures/memory-stores.js';

const LEGACY_APP_ID = 'legacy-app';
const LEGACY_SECRET = 'legacy-secret';
const WEB_ORIGIN = 'https://board.example.com';

const funnels: FunnelDef[] = [
  {
    key: 'cashier',
    name: '收银台',
    appId: LEGACY_APP_ID,
    env: 'test',
    steps: ['cashier_view', 'pay_click'],
    windowMinutes: 30,
  },
];

const feishu: FeishuGateway = {
  async exchangeCode(code: string) {
    if (code !== 'good-code') throw new Error('invalid code');
    return {
      openId: 'ou_alice',
      unionId: 'on_alice',
      userId: 'u_alice',
      name: 'Alice',
      avatarUrl: null,
      email: 'alice@example.com',
    };
  },
};

function makeConfig() {
  return loadConfig({
    NODE_ENV: 'test',
    APP_SECRETS: JSON.stringify({ [LEGACY_APP_ID]: LEGACY_SECRET }),
    TRACK_ENV: 'test',
    LOG_LEVEL: 'silent',
    AUTH_REQUIRED: 'true',
    DEV_LOGIN_ENABLED: 'true',
    FEISHU_APP_ID: 'cli_test',
    FEISHU_APP_SECRET: 'feishu-secret',
    FEISHU_REDIRECT_URI: 'https://track.example.com/api/auth/feishu/callback',
    WEB_ORIGIN: WEB_ORIGIN,
  } as unknown as NodeJS.ProcessEnv);
}

function trackPayload(appId: string): string {
  return JSON.stringify({
    appId,
    sessionId: 'sess_1',
    batchId: `batch_${Math.random().toString(36).slice(2, 10)}`,
    sentAt: Date.now(),
    batch: [{ type: 'event', timestamp: Date.now(), data: { event: 'cashier_view', properties: {} } }],
  });
}

function signedTrack(appId: string, secret: string) {
  const body = trackPayload(appId);
  const sentAt = Date.now();
  return {
    method: 'POST' as const,
    url: '/api/track',
    payload: body,
    headers: {
      'content-type': 'text/plain;charset=UTF-8',
      'x-track-app-id': appId,
      'x-track-sent-at': String(sentAt),
      'x-track-sign': signPayload(appId, sentAt, body, secret),
    },
  };
}

describe('登录鉴权与管理员接口', () => {
  let app: FastifyInstance;
  let db: FakeDb;
  let users: MemoryAdminUserStore;
  let apps: MemoryAppStore;
  let states: MemoryLoginStateStore;
  let sessions: MemorySessionStore;

  beforeEach(async () => {
    db = new FakeDb();
    users = new MemoryAdminUserStore();
    apps = new MemoryAppStore();
    states = new MemoryLoginStateStore();
    sessions = new MemorySessionStore();
    app = await buildApp({
      config: makeConfig(),
      db,
      funnels,
      logger: false,
      stores: { users, apps, states, sessions, feishu },
    });
  });

  afterEach(async () => {
    await app.close();
  });

  async function devLogin(username: string): Promise<{ token: string; role: string }> {
    const response = await app.inject({ method: 'POST', url: '/api/auth/dev-login', payload: { username } });
    expect(response.statusCode, response.body).toBe(200);
    const body = response.json() as { token: string; user: { role: string } };
    return { token: body.token, role: body.user.role };
  }

  it('未登录访问查询接口返回 401', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/meta/funnels' });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ ok: false, error: 'unauthorized' });
  });

  it('本地登录后即可访问查询接口，首个用户自动成为管理员', async () => {
    const { token, role } = await devLogin('alice');
    expect(role).toBe('admin');

    const me = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { authorization: `Bearer ${token}` } });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({ ok: true, user: { name: 'alice', role: 'admin' } });

    const funnels = await app.inject({
      method: 'GET',
      url: '/api/meta/funnels',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(funnels.statusCode).toBe(200);
  });

  it('第二个用户默认只读，访问管理接口返回 403', async () => {
    await devLogin('alice');
    const { token, role } = await devLogin('bob');
    expect(role).toBe('viewer');

    const response = await app.inject({
      method: 'GET',
      url: '/api/admin/apps',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(403);
  });

  it('管理员颁发应用：密钥只返回一次，且可立即用于签名上报', async () => {
    const { token } = await devLogin('alice');
    const headers = { authorization: `Bearer ${token}` };

    const created = await app.inject({
      method: 'POST',
      url: '/api/admin/apps',
      headers,
      payload: { name: 'Storefront', env: 'prod' },
    });
    expect(created.statusCode).toBe(200);
    const body = created.json() as { app: { appId: string; secretMask: string; status: string }; secret: string };
    expect(body.app.status).toBe('active');
    expect(body.app.appId).toMatch(/^storefront-[0-9a-f]{8}$/);
    expect(body.secret).toHaveLength(48);
    // 列表里只出现掩码
    expect(body.app.secretMask).not.toContain(body.secret);

    const list = await app.inject({ method: 'GET', url: '/api/admin/apps', headers });
    const listed = (list.json() as { apps: Array<{ appId: string; secretMask: string }> }).apps;
    expect(listed.some((item) => item.appId === body.app.appId)).toBe(true);
    expect(JSON.stringify(listed)).not.toContain(body.secret);

    const ingest = await app.inject(signedTrack(body.app.appId, body.secret));
    expect(ingest.json()).toMatchObject({ ok: true, accepted: 1 });
  });

  it('轮换密钥后旧密钥立即失效，新密钥可用', async () => {
    const { token } = await devLogin('alice');
    const headers = { authorization: `Bearer ${token}` };
    const created = (
      await app.inject({ method: 'POST', url: '/api/admin/apps', headers, payload: { name: 'Rotate Me' } })
    ).json() as { app: { appId: string }; secret: string };

    const rotated = await app.inject({
      method: 'POST',
      url: `/api/admin/apps/${created.app.appId}/rotate`,
      headers,
    });
    expect(rotated.statusCode).toBe(200);
    const newSecret = (rotated.json() as { secret: string }).secret;
    expect(newSecret).not.toBe(created.secret);

    const withOld = await app.inject(signedTrack(created.app.appId, created.secret));
    expect(withOld.json()).toMatchObject({ accepted: 0, reason: 'invalid_signature' });

    const withNew = await app.inject(signedTrack(created.app.appId, newSecret));
    expect(withNew.json()).toMatchObject({ accepted: 1 });
  });

  it('停用应用后上报被拒绝', async () => {
    const { token } = await devLogin('alice');
    const headers = { authorization: `Bearer ${token}` };
    const created = (
      await app.inject({ method: 'POST', url: '/api/admin/apps', headers, payload: { name: 'Disable Me' } })
    ).json() as { app: { appId: string }; secret: string };

    const patched = await app.inject({
      method: 'PATCH',
      url: `/api/admin/apps/${created.app.appId}`,
      headers,
      payload: { status: 'disabled' },
    });
    expect(patched.statusCode).toBe(200);

    const ingest = await app.inject(signedTrack(created.app.appId, created.secret));
    expect(ingest.json()).toMatchObject({ accepted: 0, reason: 'unknown_app_id' });
  });

  it('环境变量里的存量应用只读', async () => {
    const { token } = await devLogin('alice');
    const headers = { authorization: `Bearer ${token}` };

    const list = await app.inject({ method: 'GET', url: '/api/admin/apps', headers });
    const legacy = (list.json() as { apps: Array<{ appId: string; source: string }> }).apps.find(
      (item) => item.appId === LEGACY_APP_ID,
    );
    expect(legacy?.source).toBe('env');

    const response = await app.inject({
      method: 'POST',
      url: `/api/admin/apps/${LEGACY_APP_ID}/rotate`,
      headers,
    });
    expect(response.statusCode).toBe(409);

    // 存量应用仍可正常上报
    const ingest = await app.inject(signedTrack(LEGACY_APP_ID, LEGACY_SECRET));
    expect(ingest.json()).toMatchObject({ accepted: 1 });
  });

  it('飞书扫码登录：iframe 回调页把 token postMessage 给父窗口', async () => {
    const urlResponse = await app.inject({ method: 'GET', url: '/api/auth/feishu/login-url?mode=qr' });
    expect(urlResponse.statusCode).toBe(200);
    const { url, state } = urlResponse.json() as { url: string; state: string };
    expect(url).toContain('https://passport.feishu.cn/suite/passport/oauth/authorize');
    expect(url).toContain('client_id=cli_test');
    expect(url).toContain(`state=${state}`);

    const callback = await app.inject({
      method: 'GET',
      url: `/api/auth/feishu/callback?code=good-code&state=${state}`,
    });
    expect(callback.statusCode).toBe(200);
    expect(callback.headers['content-type']).toContain('text/html');
    expect(callback.body).toContain('postMessage');
    expect(callback.body).toContain(WEB_ORIGIN);

    const token = /"token":"([^"]+)"/.exec(callback.body)?.[1] ?? '';
    expect(token).not.toBe('');

    const me = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { authorization: `Bearer ${token}` } });
    expect(me.json()).toMatchObject({ ok: true, user: { name: 'Alice', openId: 'ou_alice', role: 'admin' } });

    // state 一次性：重复回调被拒
    const replay = await app.inject({
      method: 'GET',
      url: `/api/auth/feishu/callback?code=good-code&state=${state}`,
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.body).toContain('登录状态已失效');
  });

  it('飞书授权登录：整页跳转模式 302 回前端并带 token', async () => {
    const { state } = (
      await app.inject({ method: 'GET', url: '/api/auth/feishu/login-url?mode=redirect' })
    ).json() as { state: string };

    const callback = await app.inject({
      method: 'GET',
      url: `/api/auth/feishu/callback?code=good-code&state=${state}`,
    });
    expect(callback.statusCode).toBe(302);
    const location = String(callback.headers.location);
    expect(location.startsWith(`${WEB_ORIGIN}/login/callback#token=`)).toBe(true);

    const token = decodeURIComponent(location.split('#token=')[1] ?? '');
    const me = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { authorization: `Bearer ${token}` } });
    expect(me.statusCode).toBe(200);
  });

  it('退出登录后 token 失效', async () => {
    const { token } = await devLogin('alice');
    const headers = { authorization: `Bearer ${token}` };

    await app.inject({ method: 'POST', url: '/api/auth/logout', headers });
    const me = await app.inject({ method: 'GET', url: '/api/auth/me', headers });
    expect(me.statusCode).toBe(401);
  });

  it('管理员不能降级自己，也不能清空最后一个管理员', async () => {
    const { token } = await devLogin('alice');
    const headers = { authorization: `Bearer ${token}` };
    const me = (await app.inject({ method: 'GET', url: '/api/auth/me', headers })).json() as { user: { id: number } };

    const response = await app.inject({
      method: 'PATCH',
      url: `/api/admin/users/${me.user.id}`,
      headers,
      payload: { role: 'viewer' },
    });
    expect(response.statusCode).toBe(409);
  });
});
