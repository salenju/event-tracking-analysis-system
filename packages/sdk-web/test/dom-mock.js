'use strict';

/**
 * 极小化浏览器环境 Mock：只实现 SDK 用到的 API，便于在 Node 中跑单测。
 */

const path = require('path');

const SDK_PATH = path.resolve(__dirname, '..', 'flyway-track-sdk.js');

class MockPerformanceObserver {
  constructor(callback) {
    this.callback = callback;
    this.options = null;
    this.disconnected = false;
    MockPerformanceObserver.instances.push(this);
  }

  observe(options) {
    this.options = options;
  }

  disconnect() {
    this.disconnected = true;
  }

  emit(entries) {
    if (this.disconnected) return;
    this.callback({
      getEntries: () => entries,
      getEntriesByType: (type) => entries.filter((entry) => entry.entryType === type)
    });
  }

  static reset() {
    MockPerformanceObserver.instances = [];
  }

  // 按 observe 的 type / entryTypes 找 observer
  static byType(type) {
    return MockPerformanceObserver.instances.filter((observer) => {
      if (!observer.options) return false;
      if (observer.options.type === type) return true;
      return (observer.options.entryTypes || []).indexOf(type) !== -1;
    });
  }
}

MockPerformanceObserver.instances = [];

function addEventTargetMethods(target) {
  const listeners = new Map();

  target.addEventListener = (type, handler) => {
    if (!listeners.has(type)) listeners.set(type, []);
    const list = listeners.get(type);
    if (list.indexOf(handler) === -1) list.push(handler);
  };

  target.removeEventListener = (type, handler) => {
    const list = listeners.get(type) || [];
    const index = list.indexOf(handler);
    if (index !== -1) list.splice(index, 1);
  };

  target.dispatchEvent = (type, event) => {
    const payload = event || { type: type, target: target };
    (listeners.get(type) || []).slice().forEach((handler) => handler(payload));
  };

  target.listenerCount = (type) => (listeners.get(type) || []).length;

  return target;
}

function createElement(tagName, attributes) {
  const attrs = Object.assign({}, attributes || {});
  const element = {
    nodeType: 1,
    tagName: String(tagName).toUpperCase(),
    id: attrs.id || '',
    textContent: attrs.text || '',
    parentNode: null,
    parentElement: null,
    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(attrs, name) ? attrs[name] : null;
    },
    setAttribute(name, value) {
      attrs[name] = value;
    }
  };
  element.className = attrs['class'] || '';
  return element;
}

function appendChild(parent, child) {
  child.parentNode = parent;
  if (parent.nodeType === 1) child.parentElement = parent;
  return child;
}

function createStorage() {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => {
      map.set(key, String(value));
    },
    removeItem: (key) => {
      map.delete(key);
    },
    clear: () => {
      map.clear();
    }
  };
}

const NAVIGATION_ENTRY = {
  entryType: 'navigation',
  domainLookupStart: 10,
  domainLookupEnd: 15,
  connectStart: 15,
  connectEnd: 35,
  responseStart: 120,
  responseEnd: 150,
  domInteractive: 400,
  domComplete: 900,
  domContentLoadedEventEnd: 600,
  loadEventEnd: 1000,
  duration: 1000
};

function setup() {
  MockPerformanceObserver.reset();

  const documentTarget = addEventTargetMethods({});
  const windowTarget = addEventTargetMethods({});

  const storage = createStorage();
  const fetchCalls = [];

  const state = {
    fetchMode: 'ok', // ok | fail | http500
    xhrMode: 'ok', // ok | fail
    beaconResult: true,
    beaconCalls: [],
    xhrCalls: [],
    visibilityState: 'visible'
  };

  const documentMock = documentTarget;
  documentMock.readyState = 'complete';
  documentMock.title = 'Test Page';
  documentMock.referrer = '';
  documentMock.body = createElement('body');
  Object.defineProperty(documentMock, 'visibilityState', {
    configurable: true,
    get: () => state.visibilityState
  });

  const windowMock = windowTarget;
  windowMock.document = documentMock;
  windowMock.location = { href: 'https://example.com/page?token=secret-value&id=42#section' };
  windowMock.history = {
    pushState: function (stateObj, title, url) {
      if (url) windowMock.location.href = url;
    },
    replaceState: function (stateObj, title, url) {
      if (url) windowMock.location.href = url;
    }
  };
  windowMock.screen = { width: 1440, height: 900 };
  windowMock.innerWidth = 1280;
  windowMock.innerHeight = 800;
  windowMock.devicePixelRatio = 2;
  windowMock.navigator = {
    userAgent: 'node-test-agent',
    language: 'zh-CN',
    sendBeacon: function (url, body) {
      state.beaconCalls.push({ url: url, body: body });
      return state.beaconResult;
    }
  };
  windowMock.performance = {
    getEntriesByType: function (type) {
      return type === 'navigation' ? [NAVIGATION_ENTRY] : [];
    }
  };
  windowMock.PerformanceObserver = MockPerformanceObserver;
  if (typeof Blob !== 'undefined') windowMock.Blob = Blob;
  windowMock.localStorage = storage;

  windowMock.fetch = function (url, init) {
    fetchCalls.push({
      url: url,
      body: init && init.body,
      headers: (init && init.headers) || {},
      keepalive: !!(init && init.keepalive)
    });
    if (state.fetchMode === 'fail') return Promise.reject(new Error('network down'));
    if (state.fetchMode === 'http500') return Promise.resolve({ ok: false, status: 500 });
    if (state.fetchMode === 'http400') return Promise.resolve({ ok: false, status: 400 });
    return Promise.resolve({ ok: true, status: 200 });
  };

  windowMock.XMLHttpRequest = function () {
    const xhr = this;
    xhr.headers = {};
    xhr.open = function (method, url) {
      xhr.method = method;
      xhr.url = url;
    };
    xhr.setRequestHeader = function (key, value) {
      xhr.headers[key] = value;
    };
    xhr.send = function (body) {
      state.xhrCalls.push({ url: xhr.url, body: body, headers: xhr.headers });
      if (state.xhrMode === 'ok') {
        xhr.status = 200;
        if (xhr.onload) xhr.onload();
      } else if (xhr.onerror) {
        xhr.onerror();
      }
    };
  };

  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    writable: true,
    value: windowMock
  });

  return {
    window: windowMock,
    document: documentMock,
    state: state,
    storage: storage,
    fetchCalls: fetchCalls,
    MockPerformanceObserver: MockPerformanceObserver,
    createElement: createElement,
    appendChild: appendChild
  };
}

// 默认加载源码；设置 SDK_ENTRY=dist/flyway-track-sdk.min.js 可对压缩产物跑同一套用例
function loadSdk() {
  const entry = process.env.SDK_ENTRY
    ? path.resolve(__dirname, '..', process.env.SDK_ENTRY)
    : SDK_PATH;
  delete require.cache[require.resolve(entry)];
  return require(entry);
}

function tick(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms || 0));
}

module.exports = {
  SDK_PATH: SDK_PATH,
  setup: setup,
  loadSdk: loadSdk,
  tick: tick,
  createElement: createElement,
  appendChild: appendChild,
  MockPerformanceObserver: MockPerformanceObserver,
  NAVIGATION_ENTRY: NAVIGATION_ENTRY
};
