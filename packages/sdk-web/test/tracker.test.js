'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const vm = require('node:vm');

const { setup, loadSdk, tick, createElement, appendChild, SDK_PATH } = require('./dom-mock');

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

async function collectPayloads() {
  const payloads = [];
  harness.fetchCalls.forEach((call) => payloads.push(JSON.parse(call.body)));
  for (const call of harness.state.beaconCalls) {
    const text = typeof call.body === 'string' ? call.body : await call.body.text();
    payloads.push(JSON.parse(text));
  }
  return payloads;
}

function allRecords(payloads) {
  return payloads.reduce((acc, payload) => acc.concat(payload.batch || []), []);
}

/* ------------------------------ 配置 / 采样 ------------------------------ */

test('sampleRate: 0 时不采集任何数据（含手动 track）', async () => {
  harness = setup();
  const SDK = loadSdk();
  const tracker = new SDK(baseOptions({ sampleRate: 0 }));

  await tracker.track('manual_event', { a: 1 });
  await tracker.flush();

  assert.equal(tracker.getConfig().sampled, false);
  assert.equal(harness.fetchCalls.length, 0);
  assert.equal(harness.state.beaconCalls.length, 0);
  await tracker.destroy();
});

test('sampleRate: 1（默认）正常采集手动事件', async () => {
  harness = setup();
  const SDK = loadSdk();
  const tracker = new SDK(baseOptions());

  await tracker.track('manual_event', { a: 1 });
  await tracker.flush();

  const records = allRecords(await collectPayloads());
  assert.equal(records.length, 1);
  assert.equal(records[0].type, 'event');
  assert.equal(records[0].data.event, 'manual_event');
  await tracker.destroy();
});

test('采样率与批量配置的类型/边界校验生效', () => {
  harness = setup();
  const SDK = loadSdk();

  assert.throws(() => new SDK(baseOptions({ sampleRate: 'abc' })), /sampleRate/);
  assert.throws(() => new SDK(baseOptions({ sampleRate: 1.5 })), /sampleRate/);
  assert.throws(() => new SDK(baseOptions({ batchSize: 0 })), /batchSize/);
  assert.throws(() => new SDK(baseOptions({ batchTimeout: -1 })), /batchTimeout/);
  assert.throws(() => new SDK(baseOptions({ maxRetries: -1 })), /maxRetries/);

  // 0 是合法值：旧的 `||` 写法会把它覆盖成默认值
  const tracker = new SDK(baseOptions({ batchTimeout: 0, retryDelay: 0, maxRetries: 0, batchSize: 1 }));
  const config = tracker.getConfig();
  assert.equal(config.batchTimeout, 0);
  assert.equal(config.retryDelay, 0);
  assert.equal(config.maxRetries, 0);
  assert.equal(config.batchSize, 1);
});

/* ------------------------------ 上报行为 ------------------------------ */

test('debug: true 仍然入队并上报（只多打日志）', async () => {
  harness = setup();
  const SDK = loadSdk();
  const tracker = new SDK(baseOptions({ debug: true }));

  await tracker.track('debug_event', { value: 1 });
  await tracker.flush();

  assert.equal(harness.fetchCalls.length, 1);
  assert.equal(JSON.parse(harness.fetchCalls[0].body).batch.length, 1);
  await tracker.destroy();
});

test('track(..., { immediate: true }) 立即发送', async () => {
  harness = setup();
  const SDK = loadSdk();
  const tracker = new SDK(baseOptions({ batchSize: 100, batchTimeout: 60000 }));

  await tracker.track('instant_event', { x: 1 }, { immediate: true });

  assert.equal(harness.fetchCalls.length, 1);
  const payload = JSON.parse(harness.fetchCalls[0].body);
  assert.equal(payload.batch.length, 1);
  assert.equal(payload.batch[0].data.event, 'instant_event');
  // options 不进入数据体
  assert.deepEqual(Object.keys(payload.batch[0].data.properties), ['x']);
  await tracker.destroy();
});

test('track 与 trackEvent 的事件结构一致', async () => {
  harness = setup();
  const SDK = loadSdk();
  const tracker = new SDK(baseOptions());

  await tracker.track('first', { a: 1 });
  await tracker.trackEvent('second', { b: 2 });
  await tracker.flush();

  const records = allRecords(await collectPayloads());
  assert.equal(records.length, 2);
  records.forEach((record) => {
    assert.equal(record.type, 'event');
    assert.ok(record.data.properties, '事件数据应包含 properties');
    assert.equal(record.data.options, undefined);
  });
  await tracker.destroy();
});

test('公共字段收敛到批次层，并带 sdkVersion', async () => {
  harness = setup();
  const SDK = loadSdk();
  const tracker = new SDK(baseOptions());

  await tracker.track('batch_level', { ok: true });
  await tracker.flush();

  const payload = (await collectPayloads())[0];
  assert.equal(payload.sdkVersion, '2.2.0');
  assert.equal(payload.appId, 'test-app');
  assert.equal(payload.userId, 'user-1');
  assert.ok(payload.sessionId);
  assert.ok(payload.batchId);
  assert.equal(payload.context.viewport.width, 1280);
  assert.equal(payload.context.screen.width, 1440);
  assert.equal(payload.context.userAgent, 'node-test-agent');

  assert.equal(payload.batch[0].userAgent, undefined);
  assert.equal(payload.batch[0].screen, undefined);
  assert.equal(payload.batch[0].viewport, undefined);
  await tracker.destroy();
});

test('入队时做快照，后续修改源对象不会影响上报内容', async () => {
  harness = setup();
  const SDK = loadSdk();
  const tracker = new SDK(baseOptions());

  const source = { n: 1 };
  await tracker.report('custom', source);
  source.n = 2;
  await tracker.flush();

  const records = allRecords(await collectPayloads());
  assert.equal(records[0].data.n, 1);
  await tracker.destroy();
});

test('url 脱敏：敏感参数打码、去掉 hash', async () => {
  harness = setup();
  const SDK = loadSdk();
  const tracker = new SDK(baseOptions());

  await tracker.track('e', {});
  await tracker.flush();

  const payload = (await collectPayloads())[0];
  assert.match(payload.context.url, /token=\*\*\*/);
  assert.ok(payload.context.url.indexOf('secret-value') === -1);
  assert.ok(payload.context.url.indexOf('#section') === -1);
  assert.match(payload.context.url, /id=42/);
  await tracker.destroy();
});

test('opt-out 后不再采集，且状态持久化', async () => {
  harness = setup();
  const SDK = loadSdk();
  const tracker = new SDK(baseOptions());

  tracker.setOptOut(true);
  await tracker.track('blocked_event', {});
  await tracker.flush();

  assert.equal(harness.fetchCalls.length, 0);
  assert.equal(harness.storage.getItem('__flyway_tracker_opt_out__'), '1');

  tracker.setOptOut(false);
  await tracker.track('allowed_event', {});
  await tracker.flush();
  assert.equal(harness.fetchCalls.length, 1);
  await tracker.destroy();
});

/* ------------------------------ 点击埋点 ------------------------------ */

test('点击埋点：命中子元素，且 100ms 内连续点击不丢', async () => {
  harness = setup();
  const SDK = loadSdk();
  const tracker = new SDK(baseOptions({ enableClickTracking: true }));

  const button = createElement('button', { 'data-track': 'login_btn', class: 'btn primary', text: '登录' });
  const span = createElement('span', { class: 'icon' });
  appendChild(button, span);
  appendChild(harness.document.body, button);

  const click = () =>
    harness.document.dispatchEvent('click', { type: 'click', target: span, clientX: 10, clientY: 20 });
  click();
  click();

  await tracker.flush();
  const events = allRecords(await collectPayloads()).filter((record) => record.type === 'event');

  assert.equal(events.length, 2, '节流会吞掉第二次点击');
  assert.equal(events[0].data.event, 'login_btn');
  assert.equal(events[0].data.properties.elementInfo.tagName, 'button');
  assert.equal(events[0].data.properties.clickPosition.x, 10);
  await tracker.destroy();
});

test('点击埋点：SVG 子元素（className 为对象）不会抛错', async () => {
  harness = setup();
  const SDK = loadSdk();
  const tracker = new SDK(baseOptions({ enableClickTracking: true }));

  const button = createElement('button', { class: 'btn' });
  const svg = createElement('svg', { 'data-track': 'icon_btn', class: 'icon-svg' });
  svg.className = { baseVal: 'icon-svg' }; // 模拟 SVGAnimatedString
  appendChild(button, svg);
  appendChild(harness.document.body, button);

  harness.document.dispatchEvent('click', { type: 'click', target: svg, clientX: 1, clientY: 2 });
  await tracker.flush();

  const events = allRecords(await collectPayloads()).filter((record) => record.type === 'event');
  assert.equal(events.length, 1);
  assert.equal(events[0].data.event, 'icon_btn');
  assert.match(events[0].data.properties.elementInfo.path, /icon-svg/);
  await tracker.destroy();
});

test('点击埋点：没有 data-track 的元素不上报', async () => {
  harness = setup();
  const SDK = loadSdk();
  const tracker = new SDK(baseOptions({ enableClickTracking: true }));

  const div = createElement('div', { class: 'plain' });
  appendChild(harness.document.body, div);

  harness.document.dispatchEvent('click', { type: 'click', target: div });
  await tracker.flush();

  assert.equal(harness.fetchCalls.length, 0);
  await tracker.destroy();
});

/* ------------------------------ 生命周期 ------------------------------ */

test('destroy 移除全部监听器并还原 history', async () => {
  harness = setup();
  const SDK = loadSdk();
  const originalPush = harness.window.history.pushState;
  const originalReplace = harness.window.history.replaceState;

  const tracker = new SDK(baseOptions({ autoTrack: true, enableClickTracking: true, enableErrorTracking: true }));

  assert.notEqual(harness.window.history.pushState, originalPush, '应包装 pushState');
  assert.ok(harness.window.listenerCount('beforeunload') >= 1);
  assert.ok(harness.document.listenerCount('click') >= 1);

  await tracker.destroy();

  assert.equal(harness.window.history.pushState, originalPush);
  assert.equal(harness.window.history.replaceState, originalReplace);
  assert.equal(harness.window.listenerCount('beforeunload'), 0);
  assert.equal(harness.window.listenerCount('pagehide'), 0);
  assert.equal(harness.document.listenerCount('click'), 0);
  assert.equal(harness.document.listenerCount('visibilitychange'), 0);

  // destroy 之后事件不再上报
  const before = harness.fetchCalls.length;
  harness.document.dispatchEvent('click', { type: 'click', target: createElement('button', { 'data-track': 'x' }) });
  await tick(20);
  assert.equal(harness.fetchCalls.length, before);
});

test('getInstance 复用实例，避免重复注册', async () => {
  harness = setup();
  const SDK = loadSdk();

  const first = SDK.getInstance(baseOptions());
  const second = SDK.getInstance(baseOptions());
  assert.equal(first, second);
  assert.equal(harness.window.listenerCount('beforeunload'), 1);
  await first.destroy();
});

/* ------------------------------ 停留时长 ------------------------------ */

test('beforeunload 与 visibilitychange 不会重复统计停留时长', async () => {
  harness = setup();
  const SDK = loadSdk();
  const tracker = new SDK(baseOptions({ autoTrack: true }));

  tracker.pageTracker.startTime = Date.now() - 5000;
  harness.window.dispatchEvent('beforeunload');

  harness.state.visibilityState = 'hidden';
  harness.document.dispatchEvent('visibilitychange');

  await tick(20);
  const records = allRecords(await collectPayloads()).filter((record) => record.type === 'page_stay');

  assert.equal(records.length, 1, '停留时长被重复上报');
  assert.equal(records[0].data.trigger, 'beforeunload');
  assert.ok(records[0].data.stayTime >= 4000);
  assert.equal(records[0].data.totalStayTime, records[0].data.stayTime);
  await tracker.destroy();
});

test('SPA 路由变化会上报上一页停留时长并重置计时', async () => {
  harness = setup();
  const SDK = loadSdk();
  const tracker = new SDK(baseOptions({ autoTrack: true }));

  tracker.pageTracker.startTime = Date.now() - 3000;
  harness.window.history.pushState({}, '', 'https://example.com/next?token=abc');
  await tick(20);

  const records = allRecords(await collectPayloads()).filter((record) => record.type === 'page_stay');
  assert.equal(records.length, 1);
  assert.equal(records[0].data.trigger, 'route_change');
  assert.match(records[0].data.page, /token=\*\*\*/);
  assert.ok(records[0].data.stayTime >= 2000);
  await tracker.destroy();
});

/* ------------------------------ 性能指标 ------------------------------ */

test('load 阶段指标来自 Navigation Timing，且不出现负数', async () => {
  harness = setup();
  const SDK = loadSdk();
  const tracker = new SDK(baseOptions({ autoTrack: true }));

  await tick(10);
  await tracker.flush();

  const load = allRecords(await collectPayloads()).find(
    (record) => record.type === 'performance' && record.data.stage === 'load'
  );
  assert.ok(load, '缺少 load 阶段性能上报');
  assert.equal(load.data.loadTime, 1000);
  assert.equal(load.data.ttfb, 120);
  assert.equal(load.data.domReadyTime, 600);
  assert.equal(load.data.domParseTime, 500);

  Object.keys(load.data).forEach((key) => {
    if (typeof load.data[key] === 'number') assert.ok(load.data[key] >= 0, key + ' 不应为负数');
  });
  await tracker.destroy();
});

test('LCP/CLS/INP 在页面隐藏时上报最终值', async () => {
  harness = setup();
  const SDK = loadSdk();
  const tracker = new SDK(baseOptions({ autoTrack: true }));

  await tick(10);
  tracker.observers.paint.emit([{ name: 'first-contentful-paint', startTime: 300 }]);
  tracker.observers.lcp.emit([{ entryType: 'largest-contentful-paint', startTime: 1500 }]);
  tracker.observers['layout-shift'].emit([{ startTime: 400, value: 0.15, hadRecentInput: false }]);
  tracker.observers.event.emit([
    { interactionId: 1, duration: 120 },
    { interactionId: 2, duration: 340 }
  ]);
  tracker.observers.longtask.emit([{ duration: 120, startTime: 500 }]);

  harness.state.visibilityState = 'hidden';
  harness.document.dispatchEvent('visibilitychange');
  await tick(20);

  const final = allRecords(await collectPayloads()).find(
    (record) => record.type === 'performance' && record.data.stage === 'final'
  );
  assert.ok(final, '缺少 final 阶段性能上报');
  assert.equal(final.data.fcp, 300);
  assert.equal(final.data.lcp, 1500);
  assert.equal(final.data.cls, 0.15);
  assert.equal(final.data.inp, 340);
  assert.equal(final.data.longTaskCount, 1);
  assert.equal(final.data.trigger, 'visibilitychange');
  await tracker.destroy();
});

test('CLS 取最大 session window，而非全程累加', async () => {
  harness = setup();
  const SDK = loadSdk();
  const tracker = new SDK(baseOptions({ autoTrack: true }));

  tracker.observers['layout-shift'].emit([{ startTime: 100, value: 0.1, hadRecentInput: false }]);
  tracker.observers['layout-shift'].emit([{ startTime: 9000, value: 0.2, hadRecentInput: false }]);

  assert.equal(tracker.webVitals.cls, 0.2);
  await tracker.destroy();
});

test('FID 在首次输入后停止观察 LCP', async () => {
  harness = setup();
  const SDK = loadSdk();
  const tracker = new SDK(baseOptions({ autoTrack: true }));

  const lcpObserver = tracker.observers.lcp;
  tracker.observers['first-input'].emit([{ startTime: 700, processingStart: 712 }]);

  assert.equal(tracker.webVitals.fid, 12);
  assert.equal(lcpObserver.disconnected, true);
  await tracker.destroy();
});

test('资源监控只收集耗时超过 100ms 的资源', async () => {
  harness = setup();
  const SDK = loadSdk();
  const tracker = new SDK(baseOptions({ autoTrack: true, enableResourceTracking: true }));

  tracker.observers.resource.emit([
    { name: 'https://cdn.test/slow.js?token=abc', initiatorType: 'script', duration: 320, transferSize: 100, decodedBodySize: 100 },
    { name: 'https://cdn.test/fast.js', initiatorType: 'script', duration: 20, transferSize: 10, decodedBodySize: 10 }
  ]);

  assert.equal(tracker.resources.length, 1);
  assert.match(tracker.resources[0].name, /token=\*\*\*/);
  await tracker.destroy();
});

/* ------------------------------ 错误监控 ------------------------------ */

test('相同错误 5 秒内只上报一次', async () => {
  harness = setup();
  const SDK = loadSdk();
  const tracker = new SDK(baseOptions({ enableErrorTracking: true }));

  const errorEvent = {
    type: 'error',
    target: harness.window,
    message: 'boom',
    filename: 'https://example.com/app.js',
    lineno: 10,
    colno: 5,
    error: { stack: 'at foo' }
  };

  harness.window.dispatchEvent('error', errorEvent);
  harness.window.dispatchEvent('error', errorEvent);
  await tracker.flush();

  const errors = allRecords(await collectPayloads()).filter((record) => record.type === 'error');
  assert.equal(errors.length, 1);
  assert.equal(errors[0].data.message, 'boom');
  assert.equal(tracker.droppedErrors, 1);
  await tracker.destroy();
});

test('Promise reject 原始值（字符串）不丢信息', async () => {
  harness = setup();
  const SDK = loadSdk();
  const tracker = new SDK(baseOptions({ enableErrorTracking: true }));

  harness.window.dispatchEvent('unhandledrejection', { type: 'unhandledrejection', reason: 'plain-string-reason' });
  await tracker.flush();

  const errors = allRecords(await collectPayloads()).filter((record) => record.type === 'error');
  assert.equal(errors.length, 1);
  assert.equal(errors[0].data.message, 'plain-string-reason');
  await tracker.destroy();
});

test('资源加载失败会上报为 resource 类型错误', async () => {
  harness = setup();
  const SDK = loadSdk();
  const tracker = new SDK(baseOptions({ enableErrorTracking: true }));

  const img = createElement('img');
  img.src = 'https://cdn.test/missing.png?token=abc';
  harness.window.dispatchEvent('error', { type: 'error', target: img });
  await tracker.flush();

  const errors = allRecords(await collectPayloads()).filter((record) => record.type === 'error');
  assert.equal(errors.length, 1);
  assert.equal(errors[0].data.type, 'resource');
  assert.match(errors[0].data.source, /token=\*\*\*/);
  await tracker.destroy();
});

/* ------------------------------ 传输可靠性 ------------------------------ */

test('sendBeacon 使用 text/plain，规避 CORS 预检', async () => {
  harness = setup();
  const SDK = loadSdk();
  const tracker = new SDK(baseOptions());

  await tracker.track('e', {});
  harness.state.visibilityState = 'hidden';
  await tracker.flush({ beacon: true });

  assert.equal(harness.state.beaconCalls.length, 1);
  // Blob 会把 content-type 规范化为小写
  assert.match(harness.state.beaconCalls[0].body.type, /^text\/plain;charset=utf-8$/i);
  assert.equal(harness.fetchCalls.length, 0);
  await tracker.destroy();
});

test('重试走指数退避，失败数据落盘并在下次启动补发', async () => {
  harness = setup();
  const SDK = loadSdk();

  harness.state.fetchMode = 'fail';
  harness.state.xhrMode = 'fail';

  const first = new SDK(baseOptions({ persistFailed: true, maxRetries: 2, retryDelay: 1 }));
  await first.report('custom', { a: 1 });
  const delivered = await first.flush();

  assert.equal(delivered, false);
  assert.ok(harness.fetchCalls.length >= 3, '应包含首次请求 + 2 次重试');
  assert.ok(harness.storage.getItem('__flyway_tracker_failed__'), '失败批次未落盘');
  await first.destroy();

  harness.state.fetchMode = 'ok';
  harness.state.xhrMode = 'ok';
  const before = harness.fetchCalls.length;

  const second = new SDK(baseOptions({ persistFailed: true }));
  await tick(30);

  assert.ok(harness.fetchCalls.length > before, '下次启动没有补发');
  assert.equal(harness.storage.getItem('__flyway_tracker_failed__'), null);
  await second.destroy();
});

test('HTTP 500 会触发降级到 XHR', async () => {
  harness = setup();
  const SDK = loadSdk();

  harness.state.fetchMode = 'http500';
  const tracker = new SDK(baseOptions({ maxRetries: 0 }));

  await tracker.track('e', {});
  const ok = await tracker.flush();

  assert.equal(ok, true);
  assert.equal(harness.state.xhrCalls.length, 1);
  assert.equal(harness.state.xhrCalls[0].headers['Content-Type'], 'text/plain;charset=UTF-8');
  await tracker.destroy();
});

/* ------------------------------ 会话 / 配置 ------------------------------ */

test('会话 ID 持久化，新实例沿用同一会话', async () => {
  harness = setup();
  const SDK = loadSdk();

  const first = new SDK(baseOptions());
  const sessionId = first.getConfig().sessionId;
  await first.destroy();

  const second = new SDK(baseOptions());
  assert.equal(second.getConfig().sessionId, sessionId);
  await second.destroy();
});

test('updateConfig 校验失败不污染已有配置', async () => {
  harness = setup();
  const SDK = loadSdk();
  const tracker = new SDK(baseOptions({ userId: 'user-1' }));

  assert.throws(() => tracker.updateConfig({ sampleRate: 2 }), /sampleRate/);
  assert.equal(tracker.getConfig().sampleRate, 1);
  assert.equal(tracker.getConfig().userId, 'user-1');

  tracker.updateConfig({ userId: 'user-2' });
  assert.equal(tracker.getConfig().userId, 'user-2');
  await tracker.destroy();
});

test('切换开关会重建监听，不会重复注册', async () => {
  harness = setup();
  const SDK = loadSdk();
  const tracker = new SDK(baseOptions({ autoTrack: true, enableClickTracking: false }));

  assert.equal(harness.document.listenerCount('click'), 0);
  tracker.updateConfig({ enableClickTracking: true });
  assert.equal(harness.document.listenerCount('click'), 1);
  assert.equal(harness.window.listenerCount('beforeunload'), 1);

  await tracker.destroy();
});

/* ------------------------------ 脚本标签接入 ------------------------------ */

test('serverUrl 上的 appId/env 会被采用', async () => {
  harness = setup();
  const SDK = loadSdk();
  const tracker = new SDK(
    baseOptions({
      serverUrl: 'https://collect.test/api/track?appId=url-app&env=uat',
      appId: '',
      env: ''
    })
  );

  assert.equal(tracker.getConfig().appId, 'url-app');
  assert.equal(tracker.getConfig().env, 'uat');

  await tracker.track('url_event', { a: 1 });
  await tracker.flush();

  const payloads = await collectPayloads();
  assert.equal(payloads[0].appId, 'url-app');
  assert.equal(payloads[0].env, 'uat');
  await tracker.destroy();
});

test('显式构造参数优先于 serverUrl 上的 appId/env', () => {
  harness = setup();
  const SDK = loadSdk();
  const tracker = new SDK(
    baseOptions({
      serverUrl: 'https://collect.test/api/track?appId=url-app&env=uat',
      appId: 'explicit-app',
      env: 'prod'
    })
  );

  assert.equal(tracker.getConfig().appId, 'explicit-app');
  assert.equal(tracker.getConfig().env, 'prod');
});

test('loader stub：队列里的 init/track 在脚本加载后回放', async () => {
  harness = setup();
  harness.window.__flywayTrack = [
    [
      'init',
      {
        serverUrl: 'https://collect.test/api/track?appId=stub-app&env=dev',
        autoTrack: false,
        enableClickTracking: false,
        enableErrorTracking: false,
        batchTimeout: 10,
        retryDelay: 0,
        persistFailed: false
      }
    ],
    ['track', 'boot_event', { from: 'queue' }]
  ];

  loadSdk();

  const instance = harness.window.__flywayTrack.instance;
  assert.ok(instance, '脚本加载后应自动初始化实例');
  assert.equal(instance.getConfig().appId, 'stub-app');
  assert.equal(instance.getConfig().env, 'dev');

  // 加载后的 push 仍然生效（队列被替换成转发器）
  harness.window.__flywayTrack.push(['track', 'after_event', { from: 'forwarder' }]);
  await tick(50);

  const records = allRecords(await collectPayloads());
  const names = records.filter((record) => record.data && record.data.event).map((record) => record.data.event);
  assert.ok(names.indexOf('boot_event') !== -1, '加载前的指令应被回放');
  assert.ok(names.indexOf('after_event') !== -1, '加载后的指令应被转发');
  await instance.destroy();
});

/* ------------------------------ 打包形态 ------------------------------ */

test('UMD：支持 CommonJS 导出与浏览器全局挂载', () => {
  harness = setup();
  const SDK = loadSdk();

  assert.equal(typeof SDK, 'function');
  assert.equal(SDK.version, '2.2.0');

  const source = fs.readFileSync(SDK_PATH, 'utf8');
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox);
  assert.equal(typeof sandbox.TrackerSDK, 'function');
});
