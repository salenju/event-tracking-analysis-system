'use strict';

/**
 * v2.1.1 新增能力的回归测试：
 * 1. 内置同步 HMAC-SHA256 与服务端（Node crypto）算法一致
 * 2. 请求头携带签名（fetch / xhr）
 * 3. sendBeacon 无法带头，签名降级到 query
 * 4. 4xx 短路：不重试、不落盘补发
 * 5. 失败补发复用 batchId（服务端幂等的前提）
 * 6. payload 携带 env
 */

const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');

const { setup, loadSdk } = require('./dom-mock');

const FAILED_KEY = '__track_sdk_failed__';

let harness;

function baseOptions(overrides) {
  return Object.assign(
    {
      serverUrl: 'https://collect.test/api/track',
      appId: 'test-app',
      userId: 'user-1',
      autoTrack: false,
      enableClickTracking: false,
      enableErrorTracking: false,
      batchTimeout: 10,
      retryDelay: 0,
      persistFailed: false
    },
    overrides || {}
  );
}

function hmac(secret, message) {
  return crypto.createHmac('sha256', secret).update(message).digest('hex');
}

test('内置 HMAC-SHA256 与 Node crypto 计算结果一致', async () => {
  harness = setup();
  const SDK = loadSdk();
  const tracker = new SDK(baseOptions({ signSecret: 'test-secret' }));

  const payload = JSON.stringify({ appId: 'test-app', sessionId: 'sess_1', batch: [{ x: 1 }] });
  const auth = tracker.buildAuth(payload);

  assert.match(auth.sign, /^[0-9a-f]{64}$/);
  assert.equal(auth.sign, hmac('test-secret', 'test-app.' + auth.sentAt + '.' + payload));

  await tracker.destroy();
});

test('签名覆盖非 ASCII 内容（中文属性值）', async () => {
  harness = setup();
  const SDK = loadSdk();
  const tracker = new SDK(baseOptions({ signSecret: '密钥-secret' }));

  const payload = JSON.stringify({ title: '收银台-支付页', amount: 199.9 });
  const auth = tracker.buildAuth(payload);

  assert.equal(auth.sign, hmac('密钥-secret', 'test-app.' + auth.sentAt + '.' + payload));

  await tracker.destroy();
});

test('fetch 上报携带签名头，服务端可复算', async () => {
  harness = setup();
  const SDK = loadSdk();
  const tracker = new SDK(baseOptions({ signSecret: 'test-secret', batchSize: 100 }));

  await tracker.track('cashier_view', { orderId: 'o_1' });
  await tracker.flush();

  assert.equal(harness.fetchCalls.length, 1);
  const call = harness.fetchCalls[0];
  assert.equal(call.headers['Content-Type'], 'text/plain;charset=UTF-8');
  assert.equal(call.headers['X-Track-App-Id'], 'test-app');
  assert.equal(
    call.headers['X-Track-Sign'],
    hmac('test-secret', 'test-app.' + call.headers['X-Track-Sent-At'] + '.' + call.body)
  );

  await tracker.destroy();
});

test('未配置 signSecret 时不携带签名头', async () => {
  harness = setup();
  const SDK = loadSdk();
  const tracker = new SDK(baseOptions({ batchSize: 100 }));

  await tracker.track('cashier_view', {});
  await tracker.flush();

  const call = harness.fetchCalls[0];
  assert.equal(call.headers['X-Track-Sign'], undefined);
  assert.equal(call.headers['X-Track-App-Id'], undefined);

  await tracker.destroy();
});

test('页面隐藏时走 sendBeacon，签名降级到 URL query', async () => {
  harness = setup();
  harness.state.visibilityState = 'hidden';
  const SDK = loadSdk();
  const tracker = new SDK(baseOptions({ signSecret: 'test-secret', batchSize: 100 }));

  await tracker.track('cashier_view', {});
  await tracker.flush();

  assert.equal(harness.fetchCalls.length, 0);
  assert.equal(harness.state.beaconCalls.length, 1);

  const { url, body } = harness.state.beaconCalls[0];
  assert.match(url, /appId=test-app/);
  assert.match(url, /sentAt=\d+/);
  assert.match(url, /sign=[0-9a-f]{64}/);

  const text = typeof body === 'string' ? body : await body.text();
  const sentAt = Number(/sentAt=(\d+)/.exec(url)[1]);
  const sign = /sign=([0-9a-f]{64})/.exec(url)[1];
  assert.equal(sign, hmac('test-secret', 'test-app.' + sentAt + '.' + text));

  await tracker.destroy();
});

test('4xx 短路：只请求一次、不落盘补发', async () => {
  harness = setup();
  harness.state.fetchMode = 'http400';
  const SDK = loadSdk();
  const tracker = new SDK(baseOptions({ maxRetries: 3, batchSize: 100, persistFailed: true }));

  await tracker.track('cashier_view', {});
  await tracker.flush();

  assert.equal(harness.fetchCalls.length, 1);
  assert.equal(harness.state.xhrCalls.length, 0);
  assert.equal(harness.storage.getItem(FAILED_KEY), null);

  await tracker.destroy();
});

test('5xx 仍会重试，并最终落到本地补发', async () => {
  harness = setup();
  harness.state.fetchMode = 'http500';
  harness.state.xhrMode = 'fail';
  const SDK = loadSdk();
  const tracker = new SDK(baseOptions({ maxRetries: 2, batchSize: 100, persistFailed: true }));

  await tracker.track('cashier_view', {});
  await tracker.flush();

  assert.equal(harness.fetchCalls.length, 3); // 1 次 + 2 次重试
  assert.equal(harness.state.xhrCalls.length, 1);

  const stored = JSON.parse(harness.storage.getItem(FAILED_KEY));
  assert.equal(stored.length, 1);
  assert.ok(stored[0].batchId, '补发必须保留 batchId');

  await tracker.destroy();
});

test('补发时复用持久化的 batchId（服务端幂等）', async () => {
  harness = setup();
  harness.state.fetchMode = 'fail';
  harness.state.xhrMode = 'fail';
  const SDK = loadSdk();
  const tracker = new SDK(baseOptions({ maxRetries: 0, batchSize: 100, persistFailed: true }));

  await tracker.track('cashier_view', {});
  await tracker.flush();

  const stored = JSON.parse(harness.storage.getItem(FAILED_KEY));
  const frozenBatchId = stored[0].batchId;
  assert.ok(frozenBatchId);
  await tracker.destroy();

  // 新的页面会话：初始化时补发上一轮失败的数据
  harness.state.fetchMode = 'ok';
  const SDK2 = loadSdk();
  const tracker2 = new SDK2(baseOptions({ persistFailed: true }));
  tracker2.init();
  await new Promise((resolve) => setTimeout(resolve, 30));

  assert.ok(harness.fetchCalls.length >= 1);
  const resent = JSON.parse(harness.fetchCalls[harness.fetchCalls.length - 1].body);
  assert.equal(resent.batchId, frozenBatchId);
  assert.equal(harness.storage.getItem(FAILED_KEY), null);

  await tracker2.destroy();
});

test('payload 携带 env，便于服务端隔离测试数据', async () => {
  harness = setup();
  const SDK = loadSdk();
  const tracker = new SDK(baseOptions({ env: 'test', batchSize: 100 }));

  await tracker.track('cashier_view', {});
  await tracker.flush();

  const payload = JSON.parse(harness.fetchCalls[0].body);
  assert.equal(payload.env, 'test');
  assert.equal(payload.sdkVersion, '2.3.0');

  await tracker.destroy();
});

test('未配置 env 时不输出该字段', async () => {
  harness = setup();
  const SDK = loadSdk();
  const tracker = new SDK(baseOptions({ batchSize: 100 }));

  await tracker.track('cashier_view', {});
  await tracker.flush();

  const payload = JSON.parse(harness.fetchCalls[0].body);
  assert.equal(Object.prototype.hasOwnProperty.call(payload, 'env'), false);

  await tracker.destroy();
});
