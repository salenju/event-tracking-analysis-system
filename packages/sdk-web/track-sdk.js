/*!
 * track-sdk v2.3.0 | MIT License
 * 前端埋点 SDK：性能监控（Web Vitals）、用户行为追踪、错误监控、批量上报
 *
 * 支持 CommonJS / AMD / 浏览器全局（window.TrackerSDK）三种引入方式。
 */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
    module.exports.default = module.exports;
  } else if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else {
    root.TrackerSDK = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var SDK_VERSION = '2.3.0';

  var SESSION_KEY = '__track_sdk_session__';
  var OPT_OUT_KEY = '__track_sdk_opt_out__';
  var FAILED_KEY = '__track_sdk_failed__';
  var PROBE_KEY = '__track_sdk_probe__';

  var SESSION_TIMEOUT = 30 * 60 * 1000; // 30 分钟无操作则更换会话
  var SESSION_TOUCH_INTERVAL = 5000; // 会话活跃时间最多 5 秒落盘一次
  var ERROR_DEDUPE_WINDOW = 5000; // 相同错误 5 秒内只上报一次
  var MAX_ERROR_REPORTS = 50; // 单页最多上报 50 条错误
  var MAX_FAILED_BATCHES = 5; // 失败批次最多暂存 5 个
  var MAX_BEACON_BYTES = 60 * 1024; // Beacon 单次载荷上限（浏览器硬限制 64KB）
  var MAX_RESOURCE_ITEMS = 20; // 资源明细最多上报 20 条
  var MAX_LONG_TASK_ITEMS = 20; // 长任务明细最多上报 20 条
  var MAX_PATH_CLASSES = 3; // 元素路径中最多保留 3 个 class
  var MAX_BACKOFF = 30000;

  // 脚本标签接入：全局指令队列 + script 标签 id
  var GLOBAL_QUEUE_KEY = '__trackQueue';
  var SCRIPT_ID = 'track-sdk';
  // serverUrl 缺省时，按「SDK 自己所在域的 /api/track」推断上报地址
  var DEFAULT_ENDPOINT_PATH = '/api/track';

  // 需要脱敏的 query 参数名
  var SENSITIVE_KEY = /^(token|access_token|refresh_token|id_token|auth|authorization|password|passwd|pwd|secret|api_key|apikey|sign|signature|session|sessionid|phone|mobile|tel|email|idcard|id_card|card|code|ticket|key)$/i;

  var DEFAULT_CONFIG = {
    // 兜底占位值：浏览器里优先按 <script id="track-sdk" src> 的域推断 /api/track
    serverUrl: 'https://your-analytics-server.com/api/track',
    appId: '',
    userId: '',
    autoTrack: true,
    debug: false,
    batchSize: 10,
    batchTimeout: 5000,
    maxRetries: 3,
    retryDelay: 1000,
    enableErrorTracking: true,
    enableResourceTracking: false,
    enableClickTracking: true,
    sampleRate: 1,
    enabled: true,
    urlSanitize: true,
    persistFailed: true,
    maxQueueSize: 200,
    contentType: 'text/plain;charset=UTF-8',
    // 数据环境标识，随构建注入（test / staging / prod），服务端据此隔离漏斗
    env: '',
    // 与服务端 APP_SECRETS 对应的签名密钥，留空则不签名
    signSecret: ''
  };

  var activeInstance = null;

  /* ------------------------------------------------------------------ *
   * 工具函数
   * ------------------------------------------------------------------ */

  function isNumber(value) {
    return typeof value === 'number' && !isNaN(value) && isFinite(value);
  }

  // 与 `||` 不同：0 是合法值，只有缺省时才回退；类型不符直接报错，避免静默失效
  function readNumber(options, key, fallback) {
    var value = options[key];
    if (value === undefined || value === null) return fallback;
    if (!isNumber(value)) throw new Error('TrackerSDK: ' + key + ' must be a number');
    return value;
  }

  function readBoolean(options, key, fallback) {
    var value = options[key];
    if (value === undefined || value === null) return fallback;
    if (typeof value !== 'boolean') throw new Error('TrackerSDK: ' + key + ' must be a boolean');
    return value;
  }

  function readString(options, key, fallback) {
    var value = options[key];
    if (value === undefined || value === null) return fallback;
    if (typeof value !== 'string') throw new Error('TrackerSDK: ' + key + ' must be a string');
    return value;
  }

  /**
   * 脚本标签接入：appId / env 可以只写在 serverUrl 的 query 上
   * （https://host/api/track?appId=xxx&env=test），构造函数里的同名配置优先。
   */
  function parseEndpointOptions(serverUrl) {
    var result = { appId: '', env: '' };
    if (typeof serverUrl !== 'string') return result;
    var queryStart = serverUrl.indexOf('?');
    if (queryStart === -1) return result;

    var query = serverUrl.slice(queryStart + 1).split('#')[0];
    if (!query) return result;

    var pairs = query.split('&');
    for (var i = 0; i < pairs.length; i += 1) {
      var index = pairs[i].indexOf('=');
      if (index <= 0) continue;
      var key = decodeQueryValue(pairs[i].slice(0, index));
      var value = decodeQueryValue(pairs[i].slice(index + 1));
      if (!value) continue;
      if (key === 'appId') result.appId = value;
      else if (key === 'env') result.env = value;
    }
    return result;
  }

  function decodeQueryValue(value) {
    try {
      return decodeURIComponent(String(value).replace(/\+/g, ' '));
    } catch (error) {
      return String(value);
    }
  }

  // 负数/NaN 统一归零，避免上报 -navigationStart 这类脏数据
  function toMs(value) {
    var num = typeof value === 'number' ? value : Number(value);
    if (!isFinite(num) || isNaN(num) || num < 0) return 0;
    return Math.round(num);
  }

  function generateId(prefix) {
    return prefix + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 11);
  }

  /* ------------------------------------------------------------------ *
   * HMAC-SHA256（上报签名，v2.1.1 新增）
   *
   * sendBeacon 是同步路径，而 crypto.subtle 计算摘要必须 await，
   * 因此内置一份同步实现，保持单文件零依赖。
   * 与 Node 端等价：
   *   createHmac('sha256', secret).update(appId + '.' + sentAt + '.' + rawBody).digest('hex')
   * ------------------------------------------------------------------ */

  var SHA256_K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ];

  function rotr(value, bits) {
    return ((value >>> bits) | (value << (32 - bits))) >>> 0;
  }

  function utf8Encode(text) {
    if (typeof TextEncoder === 'function') return new TextEncoder().encode(text);
    var bytes = [];
    for (var i = 0; i < text.length; i += 1) {
      var code = text.charCodeAt(i);
      if (code < 0x80) {
        bytes.push(code);
      } else if (code < 0x800) {
        bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
      } else if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
        var point = 0x10000 + ((code - 0xd800) << 10) + (text.charCodeAt(i + 1) - 0xdc00);
        i += 1;
        bytes.push(
          0xf0 | (point >> 18),
          0x80 | ((point >> 12) & 0x3f),
          0x80 | ((point >> 6) & 0x3f),
          0x80 | (point & 0x3f)
        );
      } else {
        bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
      }
    }
    return new Uint8Array(bytes);
  }

  function concatBytes(left, right) {
    var merged = new Uint8Array(left.length + right.length);
    merged.set(left, 0);
    merged.set(right, left.length);
    return merged;
  }

  function wordsToBytes(words) {
    var bytes = new Uint8Array(words.length * 4);
    for (var i = 0; i < words.length; i += 1) {
      bytes[i * 4] = (words[i] >>> 24) & 0xff;
      bytes[i * 4 + 1] = (words[i] >>> 16) & 0xff;
      bytes[i * 4 + 2] = (words[i] >>> 8) & 0xff;
      bytes[i * 4 + 3] = words[i] & 0xff;
    }
    return bytes;
  }

  function bytesToHex(bytes) {
    var hex = '';
    for (var i = 0; i < bytes.length; i += 1) {
      var value = bytes[i].toString(16);
      hex += value.length === 1 ? '0' + value : value;
    }
    return hex;
  }

  function sha256Bytes(bytes) {
    var H = new Uint32Array([
      0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19
    ]);
    var length = bytes.length;
    var paddedLength = (((length + 8) >> 6) + 1) * 64;
    var padded = new Uint8Array(paddedLength);
    padded.set(bytes, 0);
    padded[length] = 0x80;
    var view = new DataView(padded.buffer);
    view.setUint32(paddedLength - 8, Math.floor(length / 0x20000000));
    view.setUint32(paddedLength - 4, (length << 3) >>> 0);

    var w = new Uint32Array(64);
    for (var offset = 0; offset < paddedLength; offset += 64) {
      for (var i = 0; i < 16; i += 1) w[i] = view.getUint32(offset + i * 4);
      for (i = 16; i < 64; i += 1) {
        var s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
        var s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
      }
      var a = H[0];
      var b = H[1];
      var c = H[2];
      var d = H[3];
      var e = H[4];
      var f = H[5];
      var g = H[6];
      var h = H[7];
      for (i = 0; i < 64; i += 1) {
        var S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
        var ch = (e & f) ^ (~e & g);
        var t1 = (h + S1 + ch + SHA256_K[i] + w[i]) >>> 0;
        var S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
        var maj = (a & b) ^ (a & c) ^ (b & c);
        var t2 = (S0 + maj) >>> 0;
        h = g;
        g = f;
        f = e;
        e = (d + t1) >>> 0;
        d = c;
        c = b;
        b = a;
        a = (t1 + t2) >>> 0;
      }
      H[0] = (H[0] + a) >>> 0;
      H[1] = (H[1] + b) >>> 0;
      H[2] = (H[2] + c) >>> 0;
      H[3] = (H[3] + d) >>> 0;
      H[4] = (H[4] + e) >>> 0;
      H[5] = (H[5] + f) >>> 0;
      H[6] = (H[6] + g) >>> 0;
      H[7] = (H[7] + h) >>> 0;
    }
    return H;
  }

  function hmacSha256Hex(secret, message) {
    var blockSize = 64;
    var key = utf8Encode(secret);
    if (key.length > blockSize) key = wordsToBytes(sha256Bytes(key));
    var ipad = new Uint8Array(blockSize);
    var opad = new Uint8Array(blockSize);
    for (var i = 0; i < blockSize; i += 1) {
      var byte = i < key.length ? key[i] : 0;
      ipad[i] = byte ^ 0x36;
      opad[i] = byte ^ 0x5c;
    }
    var inner = sha256Bytes(concatBytes(ipad, utf8Encode(message)));
    return bytesToHex(wordsToBytes(sha256Bytes(concatBytes(opad, wordsToBytes(inner)))));
  }

  // 入队时做快照，避免后续被 observer 改写
  function clone(value) {
    if (value === null || typeof value !== 'object') return value;
    try {
      return JSON.parse(JSON.stringify(value));
    } catch (error) {
      if (Array.isArray(value)) return value.slice();
      var copy = {};
      for (var key in value) {
        if (Object.prototype.hasOwnProperty.call(value, key)) copy[key] = value[key];
      }
      return copy;
    }
  }

  var resolvedServerUrl = null;

  /**
   * serverUrl 缺省时的默认上报地址：取 SDK 自身 <script> 所在域的 /api/track。
   * 这样接入方不用传 serverUrl 也能把数据发回本系统；想留在自己环境就显式传 serverUrl。
   */
  function resolveDefaultServerUrl() {
    if (resolvedServerUrl !== null) return resolvedServerUrl;
    resolvedServerUrl = DEFAULT_CONFIG.serverUrl;

    var doc = typeof document !== 'undefined' ? document : typeof window !== 'undefined' ? window.document : null;
    if (!doc) return resolvedServerUrl;

    var script = doc.currentScript;
    if (!script && typeof doc.getElementById === 'function') script = doc.getElementById(SCRIPT_ID);
    var src = script && script.src;
    if (!src) return resolvedServerUrl;

    try {
      resolvedServerUrl = new URL(DEFAULT_ENDPOINT_PATH, src).href;
    } catch (error) {
      /* 保留占位地址 */
    }
    return resolvedServerUrl;
  }

  function buildConfig(options) {
    var opts = options || {};
    var serverUrl = readString(opts, 'serverUrl', '') || resolveDefaultServerUrl();
    var endpoint = parseEndpointOptions(serverUrl);
    return {
      serverUrl: serverUrl,
      // 显式配置优先；缺省时回落到 serverUrl 上的 query（脚本标签接入）
      appId: readString(opts, 'appId', DEFAULT_CONFIG.appId) || endpoint.appId,
      userId: readString(opts, 'userId', DEFAULT_CONFIG.userId),
      autoTrack: readBoolean(opts, 'autoTrack', DEFAULT_CONFIG.autoTrack),
      debug: readBoolean(opts, 'debug', DEFAULT_CONFIG.debug),
      batchSize: readNumber(opts, 'batchSize', DEFAULT_CONFIG.batchSize),
      batchTimeout: readNumber(opts, 'batchTimeout', DEFAULT_CONFIG.batchTimeout),
      maxRetries: readNumber(opts, 'maxRetries', DEFAULT_CONFIG.maxRetries),
      retryDelay: readNumber(opts, 'retryDelay', DEFAULT_CONFIG.retryDelay),
      enableErrorTracking: readBoolean(opts, 'enableErrorTracking', DEFAULT_CONFIG.enableErrorTracking),
      enableResourceTracking: readBoolean(opts, 'enableResourceTracking', DEFAULT_CONFIG.enableResourceTracking),
      enableClickTracking: readBoolean(opts, 'enableClickTracking', DEFAULT_CONFIG.enableClickTracking),
      sampleRate: readNumber(opts, 'sampleRate', DEFAULT_CONFIG.sampleRate),
      enabled: readBoolean(opts, 'enabled', DEFAULT_CONFIG.enabled),
      urlSanitize: readBoolean(opts, 'urlSanitize', DEFAULT_CONFIG.urlSanitize),
      persistFailed: readBoolean(opts, 'persistFailed', DEFAULT_CONFIG.persistFailed),
      maxQueueSize: readNumber(opts, 'maxQueueSize', DEFAULT_CONFIG.maxQueueSize),
      contentType: readString(opts, 'contentType', DEFAULT_CONFIG.contentType),
      env: readString(opts, 'env', DEFAULT_CONFIG.env) || endpoint.env,
      signSecret: readString(opts, 'signSecret', DEFAULT_CONFIG.signSecret)
    };
  }

  // 校验在赋值之前完成，避免 updateConfig 抛错后留下非法配置
  function validateConfig(config, warnAppId) {
    if (!config.serverUrl || typeof config.serverUrl !== 'string') {
      throw new Error('TrackerSDK: serverUrl is required and must be a non-empty string');
    }
    if (!isNumber(config.sampleRate) || config.sampleRate < 0 || config.sampleRate > 1) {
      throw new Error('TrackerSDK: sampleRate must be a number between 0 and 1');
    }
    if (!isNumber(config.batchSize) || config.batchSize < 1) {
      throw new Error('TrackerSDK: batchSize must be a number >= 1');
    }
    if (!isNumber(config.batchTimeout) || config.batchTimeout < 0) {
      throw new Error('TrackerSDK: batchTimeout must be a number >= 0');
    }
    if (!isNumber(config.maxRetries) || config.maxRetries < 0) {
      throw new Error('TrackerSDK: maxRetries must be a number >= 0');
    }
    if (!isNumber(config.retryDelay) || config.retryDelay < 0) {
      throw new Error('TrackerSDK: retryDelay must be a number >= 0');
    }
    if (!isNumber(config.maxQueueSize) || config.maxQueueSize < 1) {
      throw new Error('TrackerSDK: maxQueueSize must be a number >= 1');
    }
    if (warnAppId && !config.appId) {
      console.warn('TrackerSDK: appId is recommended for better data analysis');
    }
  }

  /* ------------------------------------------------------------------ *
   * SDK 主体
   * ------------------------------------------------------------------ */

  class TrackerSDK {
    constructor(options) {
      var config = buildConfig(options);
      validateConfig(config, true);

      this.version = SDK_VERSION;
      this.config = config;
      this.isBrowser = typeof window !== 'undefined' && !!window.document;

      // 内部状态
      this.reportQueue = [];
      this.batchTimer = null;
      this.observers = {};
      this.listeners = [];
      this.historyPatches = [];
      this.navTiming = null;
      this.webVitals = { fcp: null, lcp: null, fid: null, cls: 0 };
      this.clsState = { value: 0, sessionValue: 0, firstTimestamp: 0, lastTimestamp: 0 };
      this.interactionDurations = {};
      this.longTasks = [];
      this.resources = [];
      this.errorTimestamps = {};
      this.errorReports = 0;
      this.droppedErrors = 0;
      this.droppedRecords = 0;
      this.pageTracker = null;
      this.finalReported = false;
      this.pageEndHandled = false;
      this.isInitialized = false;
      this.destroyed = false;
      this._storage = undefined;
      this._lastSessionTouch = 0;

      // 采样一次性决定，作用于所有类型的数据（含手动 track）
      this.sampled = Math.random() < config.sampleRate;
      this.optedOut = this.readOptOut();
      this.session = this.loadSession();

      if (activeInstance && activeInstance !== this && activeInstance.isInitialized) {
        console.warn('TrackerSDK: 已存在运行中的实例，多实例会导致重复上报，建议改用 TrackerSDK.getInstance()');
      }
      activeInstance = this;

      this.init();
    }

    /* ---------------------------- 初始化 ---------------------------- */

    init() {
      var self = this;
      try {
        if (this.isInitialized) return this;
        if (!this.isBrowser) {
          console.warn('TrackerSDK: 当前不是浏览器环境，SDK 不会采集任何数据');
          return this;
        }
        if (!this.config.enabled) {
          this.log('SDK disabled by config, skip initialization');
          return this;
        }
        if (!this.sampled) {
          this.log('Sampled out (sampleRate=' + this.config.sampleRate + '), all data will be dropped');
          return this;
        }

        if (this.config.autoTrack) {
          this.setupPerformanceTracking();
          this.setupPageStayTime();
        }
        if (this.config.enableClickTracking) this.setupClickTracking();
        if (this.config.enableErrorTracking) this.setupErrorTracking();
        if (this.config.enableResourceTracking) this.setupResourceTracking();

        // 页面结束流程只注册一次，避免与停留时长监听重复
        this.on(window, 'pagehide', function () {
          self.handlePageEnd('pagehide');
        });
        this.on(window, 'beforeunload', function () {
          self.handlePageEnd('beforeunload');
        });

        this.isInitialized = true;
        this.log('TrackerSDK ' + SDK_VERSION + ' initialized successfully');

        if (this.config.persistFailed) this.resumeFailedBatches();
      } catch (error) {
        console.error('TrackerSDK initialization failed:', error);
      }
      return this;
    }

    /* ---------------------------- 日志 ---------------------------- */

    log(message, data) {
      if (!this.config.debug) return;
      if (data === undefined) console.log('[TrackerSDK] ' + message);
      else console.log('[TrackerSDK] ' + message, data);
    }

    /* ------------------------ 监听器 / observer ------------------------ */

    on(target, type, handler, options) {
      if (!target || typeof target.addEventListener !== 'function') return;
      target.addEventListener(type, handler, options);
      this.listeners.push({ target: target, type: type, handler: handler, options: options });
    }

    offAll() {
      for (var i = 0; i < this.listeners.length; i++) {
        var entry = this.listeners[i];
        try {
          entry.target.removeEventListener(entry.type, entry.handler, entry.options);
        } catch (error) {
          /* ignore */
        }
      }
      this.listeners = [];
    }

    createObserver(key, callback, observeOptions) {
      try {
        if (!window.PerformanceObserver) return null;
        var observer = new window.PerformanceObserver(function (list) {
          callback(list.getEntries());
        });
        observer.observe(observeOptions);
        this.observers[key] = observer;
        return observer;
      } catch (error) {
        this.log('Failed to create ' + key + ' observer:', error);
        return null;
      }
    }

    disconnectObserver(key) {
      var observer = this.observers[key];
      if (!observer) return;
      try {
        observer.disconnect();
      } catch (error) {
        this.log('Observer disconnect error:', error);
      }
      delete this.observers[key];
    }

    disconnectAllObservers() {
      for (var key in this.observers) {
        if (Object.prototype.hasOwnProperty.call(this.observers, key)) this.disconnectObserver(key);
      }
    }

    /* ---------------------------- 性能监控 ---------------------------- */

    setupPerformanceTracking() {
      var self = this;
      try {
        this.setupModernMetrics();
        var onLoaded = function () {
          if (self.destroyed) return;
          self.collectNavigationTiming();
          self.reportLoadMetrics();
        };
        if (window.document.readyState === 'complete') {
          setTimeout(onLoaded, 0);
        } else {
          this.on(window, 'load', onLoaded);
        }
      } catch (error) {
        this.log('Performance tracking setup failed:', error);
      }
    }

    setupModernMetrics() {
      if (!window.PerformanceObserver) return;
      this.setupWebVitals();
      this.setupLongTaskMonitoring();
    }

    // 使用 PerformanceNavigationTiming，并做负数保护
    collectNavigationTiming() {
      var nav = null;
      try {
        if (window.performance && typeof window.performance.getEntriesByType === 'function') {
          var entries = window.performance.getEntriesByType('navigation');
          if (entries && entries.length) nav = entries[0];
        }
      } catch (error) {
        this.log('Read navigation timing failed:', error);
      }

      if (nav) {
        this.navTiming = {
          dnsTime: toMs(nav.domainLookupEnd - nav.domainLookupStart),
          tcpTime: toMs(nav.connectEnd - nav.connectStart),
          ttfb: toMs(nav.responseStart),
          responseTime: toMs(nav.responseEnd - nav.responseStart),
          domInteractive: toMs(nav.domInteractive),
          domParseTime: toMs(nav.domComplete - nav.domInteractive),
          domReadyTime: toMs(nav.domContentLoadedEventEnd),
          loadTime: toMs(nav.loadEventEnd || nav.duration)
        };
        return this.navTiming;
      }

      // 老浏览器回退：PerformanceTiming（已废弃但仍有浏览器提供）
      var legacy = window.performance && window.performance.timing;
      if (!legacy || !legacy.navigationStart) return null;

      var start = legacy.navigationStart;
      this.navTiming = {
        dnsTime: toMs(legacy.domainLookupEnd - legacy.domainLookupStart),
        tcpTime: toMs(legacy.connectEnd - legacy.connectStart),
        ttfb: toMs(legacy.responseStart - start),
        responseTime: toMs(legacy.responseEnd - legacy.responseStart),
        domInteractive: toMs(legacy.domInteractive - start),
        domParseTime: toMs(legacy.domComplete - legacy.domLoading),
        domReadyTime: toMs(legacy.domContentLoadedEventEnd - start),
        loadTime: toMs(legacy.loadEventEnd - start)
      };
      return this.navTiming;
    }

    // load 阶段只上报已确定的导航指标 + FCP，LCP/CLS/INP 留到 final 阶段
    reportLoadMetrics() {
      var data = { stage: 'load' };
      if (this.navTiming) {
        for (var key in this.navTiming) {
          if (Object.prototype.hasOwnProperty.call(this.navTiming, key)) data[key] = this.navTiming[key];
        }
      }
      if (this.webVitals.fcp !== null) data.fcp = this.webVitals.fcp;
      this.report('performance', data);
    }

    setupWebVitals() {
      var self = this;

      this.createObserver('paint', function (entries) {
        for (var i = 0; i < entries.length; i++) {
          if (entries[i].name === 'first-contentful-paint') {
            self.webVitals.fcp = Math.round(entries[i].startTime);
          }
        }
      }, { entryTypes: ['paint'], buffered: true });

      this.createObserver('lcp', function (entries) {
        var last = entries[entries.length - 1];
        if (last) self.webVitals.lcp = Math.round(last.startTime);
      }, { type: 'largest-contentful-paint', buffered: true });

      this.createObserver('first-input', function (entries) {
        var first = entries[0];
        if (!first) return;
        self.webVitals.fid = Math.round(first.processingStart - first.startTime);
        // 首次交互后 LCP 定型，停止观察
        self.disconnectObserver('lcp');
        self.disconnectObserver('first-input');
      }, { type: 'first-input', buffered: true });

      // CLS 取最大 session window，而不是全程简单累加
      this.createObserver('layout-shift', function (entries) {
        for (var i = 0; i < entries.length; i++) {
          var entry = entries[i];
          if (entry.hadRecentInput) continue;
          var state = self.clsState;
          if (
            !state.firstTimestamp ||
            entry.startTime - state.lastTimestamp > 1000 ||
            entry.startTime - state.firstTimestamp > 5000
          ) {
            state.sessionValue = 0;
            state.firstTimestamp = entry.startTime;
          }
          state.sessionValue += entry.value;
          state.lastTimestamp = entry.startTime;
          if (state.sessionValue > state.value) state.value = state.sessionValue;
        }
        self.webVitals.cls = Math.round(self.clsState.value * 10000) / 10000;
      }, { type: 'layout-shift', buffered: true });

      // INP：按 interactionId 归组后取 p98
      this.createObserver('event', function (entries) {
        for (var i = 0; i < entries.length; i++) {
          var entry = entries[i];
          if (!entry.interactionId) continue;
          var previous = self.interactionDurations[entry.interactionId] || 0;
          if (entry.duration > previous) self.interactionDurations[entry.interactionId] = entry.duration;
        }
      }, { type: 'event', buffered: true, durationThreshold: 40 });
    }

    setupLongTaskMonitoring() {
      var self = this;
      this.createObserver('longtask', function (entries) {
        for (var i = 0; i < entries.length; i++) {
          if (self.longTasks.length >= MAX_LONG_TASK_ITEMS * 5) break;
          self.longTasks.push({
            duration: Math.round(entries[i].duration),
            startTime: Math.round(entries[i].startTime)
          });
        }
      }, { type: 'longtask', buffered: true });
    }

    setupResourceTracking() {
      var self = this;
      this.createObserver('resource', function (entries) {
        for (var i = 0; i < entries.length; i++) {
          var entry = entries[i];
          if (!entry.duration || entry.duration <= 100) continue;
          if (self.resources.length >= MAX_RESOURCE_ITEMS * 5) break;
          self.resources.push({
            name: self.sanitizeUrl(entry.name),
            type: entry.initiatorType || 'other',
            duration: Math.round(entry.duration),
            size: entry.transferSize || 0,
            cached: entry.transferSize === 0 && entry.decodedBodySize > 0
          });
        }
      }, { entryTypes: ['resource'], buffered: true });
    }

    computeInp() {
      var durations = [];
      for (var key in this.interactionDurations) {
        if (Object.prototype.hasOwnProperty.call(this.interactionDurations, key)) {
          durations.push(this.interactionDurations[key]);
        }
      }
      if (!durations.length) return null;
      durations.sort(function (a, b) {
        return a - b;
      });
      var index = Math.min(durations.length - 1, Math.max(0, Math.ceil(durations.length * 0.98) - 1));
      return Math.round(durations[index]);
    }

    // 现代指标在页面隐藏/卸载时一次性上报最终值
    reportFinalVitals(trigger) {
      if (this.finalReported || !this.isInitialized || !this.isBrowser) return;
      if (!this.config.autoTrack) return;
      this.finalReported = true;

      var longTasks = this.longTasks;
      var total = 0;
      for (var i = 0; i < longTasks.length; i++) total += longTasks[i].duration;
      var resources = this.resources
        .slice()
        .sort(function (a, b) {
          return b.duration - a.duration;
        })
        .slice(0, MAX_RESOURCE_ITEMS);

      this.report('performance', {
        stage: 'final',
        trigger: trigger,
        fcp: this.webVitals.fcp,
        lcp: this.webVitals.lcp,
        cls: this.webVitals.cls,
        fid: this.webVitals.fid,
        inp: this.computeInp(),
        longTaskCount: longTasks.length,
        longTaskTotal: Math.round(total),
        longTasks: longTasks.slice(0, MAX_LONG_TASK_ITEMS),
        resources: resources
      });

      this.disconnectObserver('lcp');
      this.disconnectObserver('layout-shift');
      this.disconnectObserver('event');
      this.disconnectObserver('longtask');
      this.disconnectObserver('resource');
    }

    /* ---------------------------- 页面停留 ---------------------------- */

    setupPageStayTime() {
      var self = this;
      this.pageTracker = {
        startTime: Date.now(),
        totalTime: 0,
        pageUrl: window.location.href,
        isVisible: window.document.visibilityState !== 'hidden'
      };

      this.on(window.document, 'visibilitychange', function () {
        self.handleVisibilityChange();
      });
      this.wrapHistoryMethod('pushState');
      this.wrapHistoryMethod('replaceState');
      this.on(window, 'popstate', function () {
        self.handleUrlChange();
      });
    }

    handleVisibilityChange() {
      if (this.destroyed) return;
      var hidden = window.document.visibilityState === 'hidden';

      if (hidden) {
        this.accumulateStayTime('hidden');
        this.reportFinalVitals('visibilitychange');
        this.flushQueue({ beacon: true });
        return;
      }

      if (this.pageTracker) {
        this.pageTracker.isVisible = true;
        this.pageTracker.startTime = Date.now();
        this.pageEndHandled = false;
      }
    }

    // 统一的页面结束流程：停留时长 → 最终指标 → 发送队列
    handlePageEnd(trigger) {
      if (this.pageEndHandled || this.destroyed) return;
      this.pageEndHandled = true;
      this.accumulateStayTime(trigger);
      this.reportFinalVitals(trigger);
      this.flushQueue({ beacon: true });
    }

    // 每段停留只累加一次，避免 beforeunload 与 visibilitychange 重复计数
    accumulateStayTime(trigger) {
      var tracker = this.pageTracker;
      if (!tracker || !tracker.isVisible) return;

      var now = Date.now();
      var segment = now - tracker.startTime;
      tracker.totalTime += segment;
      tracker.startTime = now;
      tracker.isVisible = false;
      this.sendPageStayData(segment, tracker.totalTime, trigger, tracker.pageUrl);
    }

    handleUrlChange() {
      var tracker = this.pageTracker;
      if (!tracker || this.destroyed) return;

      var newUrl = window.location.href;
      if (newUrl === tracker.pageUrl) return;

      if (tracker.isVisible) this.accumulateStayTime('route_change');

      tracker.pageUrl = newUrl;
      tracker.startTime = Date.now();
      tracker.totalTime = 0;
      tracker.isVisible = window.document.visibilityState !== 'hidden';
    }

    sendPageStayData(stayTime, totalStayTime, trigger, url) {
      if (!(stayTime >= 1000)) return; // 小于 1 秒的片段不单独上报
      this.report('page_stay', {
        stayTime: Math.round(stayTime),
        totalStayTime: Math.round(totalStayTime),
        trigger: trigger,
        page: this.sanitizeUrl(url || (this.pageTracker && this.pageTracker.pageUrl) || ''),
        referrer: this.sanitizeUrl(window.document.referrer || '')
      });
    }

    wrapHistoryMethod(method) {
      if (!window.history || typeof window.history[method] !== 'function') return;
      var original = window.history[method];
      var self = this;
      var patched = function () {
        var result = original.apply(this, arguments);
        try {
          self.handleUrlChange();
        } catch (error) {
          self.log('history hook error:', error);
        }
        return result;
      };
      window.history[method] = patched;
      this.historyPatches.push({ method: method, original: original, patched: patched });
    }

    restoreHistory() {
      for (var i = 0; i < this.historyPatches.length; i++) {
        var patch = this.historyPatches[i];
        if (window.history && window.history[patch.method] === patch.patched) {
          window.history[patch.method] = patch.original;
        }
      }
      this.historyPatches = [];
    }

    /* ---------------------------- 点击埋点 ---------------------------- */

    setupClickTracking() {
      var self = this;
      // 不节流：埋点需要全量采集
      this.on(window.document, 'click', function (event) {
        try {
          var element = self.findTrackElement(event.target);
          if (!element) return;
          var trackName = element.getAttribute('data-track');
          if (!trackName) return;

          self.trackEvent(trackName, {
            elementInfo: {
              tagName: element.tagName ? String(element.tagName).toLowerCase() : '',
              id: element.id || null,
              className: element.getAttribute('class') || null,
              text: element.textContent ? element.textContent.trim().slice(0, 100) : null,
              path: self.getElementPath(element)
            },
            clickPosition: { x: event.clientX || 0, y: event.clientY || 0 },
            viewport: { width: window.innerWidth, height: window.innerHeight }
          });
        } catch (error) {
          self.log('Click tracking error:', error);
        }
      }, true);
    }

    // 支持点击带 data-track 元素的子节点（图标、span）
    findTrackElement(node) {
      var current = node;
      while (current && current.nodeType === 1) {
        if (typeof current.getAttribute === 'function' && current.getAttribute('data-track')) {
          return current;
        }
        current = current.parentNode;
      }
      return null;
    }

    getElementPath(element) {
      var path = [];
      var current = element;

      while (current && current.nodeType === 1 && current !== window.document.body) {
        var selector = current.tagName ? String(current.tagName).toLowerCase() : '';
        if (current.id) {
          selector += '#' + current.id;
        } else {
          // SVG 元素的 className 是 SVGAnimatedString，必须走 getAttribute
          var classAttr = typeof current.getAttribute === 'function' ? current.getAttribute('class') : '';
          if (classAttr) {
            var classes = String(classAttr).split(/\s+/).filter(Boolean).slice(0, MAX_PATH_CLASSES);
            if (classes.length) selector += '.' + classes.join('.');
          }
        }
        path.unshift(selector);
        current = current.parentElement || current.parentNode;
      }

      return path.join(' > ');
    }

    /* ---------------------------- 错误监控 ---------------------------- */

    setupErrorTracking() {
      var self = this;

      // JS 运行时错误
      this.on(window, 'error', function (event) {
        if (!event || (event.target && event.target !== window)) return; // 资源错误交给下面的捕获处理器
        self.reportError({
          type: 'javascript',
          message: event.message ? String(event.message) : 'Unknown error',
          filename: event.filename ? self.sanitizeUrl(event.filename) : '',
          lineno: event.lineno || 0,
          colno: event.colno || 0,
          stack: event.error && event.error.stack ? String(event.error.stack).slice(0, 2000) : null
        });
      });

      // Promise 未捕获错误（兼容 reason 为字符串等原始值）
      this.on(window, 'unhandledrejection', function (event) {
        var info = self.normalizeReason(event ? event.reason : null);
        self.reportError({
          type: 'promise',
          message: info.message,
          name: info.name,
          stack: info.stack
        });
      });

      // 资源加载错误（不冒泡，需在捕获阶段监听）
      this.on(window, 'error', function (event) {
        var target = event && event.target;
        if (!target || target === window || !target.tagName) return;
        self.reportError({
          type: 'resource',
          message: 'Failed to load ' + String(target.tagName).toLowerCase(),
          source: self.sanitizeUrl(target.src || target.href || '')
        });
      }, true);
    }

    normalizeReason(reason) {
      if (reason === null || reason === undefined) {
        return { message: 'Unhandled Promise Rejection', name: null, stack: null };
      }
      if (typeof reason === 'string') return { message: reason, name: null, stack: null };
      if (typeof reason === 'object') {
        return {
          message: reason.message ? String(reason.message) : String(reason),
          name: reason.name ? String(reason.name) : null,
          stack: reason.stack ? String(reason.stack).slice(0, 2000) : null
        };
      }
      return { message: String(reason), name: null, stack: null };
    }

    reportError(errorInfo) {
      if (!errorInfo) return Promise.resolve(false);

      var key = [errorInfo.type, errorInfo.message, errorInfo.filename, errorInfo.lineno].join('|');
      var now = Date.now();
      var last = this.errorTimestamps[key];

      // 去重 + 限流，防止渲染循环抛错刷爆队列
      if (last && now - last < ERROR_DEDUPE_WINDOW) {
        this.droppedErrors++;
        return Promise.resolve(false);
      }
      if (this.errorReports >= MAX_ERROR_REPORTS) {
        this.droppedErrors++;
        return Promise.resolve(false);
      }

      this.errorTimestamps[key] = now;
      this.errorReports++;
      return this.report('error', errorInfo);
    }

    /* ---------------------------- 事件上报 ---------------------------- */

    trackEvent(eventName, properties) {
      if (!eventName || typeof eventName !== 'string') {
        this.log('Invalid event name:', eventName);
        return Promise.resolve(false);
      }
      return this.report('event', {
        event: eventName,
        properties: clone(properties || {})
      });
    }

    // 与 trackEvent 结构保持一致，options 只用于控制发送时机，不进入数据体
    track(eventName, properties, options) {
      var self = this;
      var opts = options || {};
      var result = this.trackEvent(eventName, properties);
      if (opts.immediate) {
        return result.then(function () {
          return self.flush();
        });
      }
      return result;
    }

    report(type, data) {
      if (this.destroyed || !this.isBrowser) return Promise.resolve(false);
      if (!this.config.enabled || this.optedOut) return Promise.resolve(false);
      if (!this.sampled) {
        this.log('Dropped ' + type + ' record: not sampled');
        return Promise.resolve(false);
      }

      try {
        var record = {
          type: type,
          timestamp: Date.now(),
          data: clone(data === undefined ? {} : data)
        };
        if (this.config.debug) this.log('Reporting ' + type + ':', record);
        this.addToQueue(record);
        this.touchSession();
        return Promise.resolve(true);
      } catch (error) {
        this.log('Report error:', error);
        return Promise.resolve(false);
      }
    }

    addToQueue(record) {
      if (this.reportQueue.length >= this.config.maxQueueSize) {
        this.reportQueue.shift();
        this.droppedRecords++;
      }
      this.reportQueue.push(record);

      if (this.reportQueue.length >= this.config.batchSize) {
        this.flushQueue();
      } else {
        this.setBatchTimer();
      }
    }

    setBatchTimer() {
      if (this.batchTimer) return;
      var self = this;
      this.batchTimer = setTimeout(function () {
        self.batchTimer = null;
        self.flushQueue();
      }, this.config.batchTimeout);
    }

    // 公共字段收敛到批次层，避免每条记录重复携带
    // batchId 支持外部传入：失败补发时复用原 batchId，保证服务端幂等
    buildBatchPayload(records, batchId) {
      var nav = window.navigator || {};
      var screenRef = window.screen || {};
      return {
        appId: this.config.appId,
        sdkVersion: SDK_VERSION,
        userId: this.config.userId,
        sessionId: this.session.id,
        batchId: batchId || generateId('batch'),
        sentAt: Date.now(),
        env: this.config.env || undefined,
        context: {
          url: this.sanitizeUrl(window.location.href),
          referrer: this.sanitizeUrl(window.document.referrer || ''),
          title: window.document.title || '',
          userAgent: nav.userAgent || '',
          language: nav.language || '',
          screen: { width: screenRef.width || 0, height: screenRef.height || 0 },
          viewport: { width: window.innerWidth || 0, height: window.innerHeight || 0 },
          devicePixelRatio: window.devicePixelRatio || 1
        },
        batch: records
      };
    }

    flush(options) {
      return this.flushQueue(options);
    }

    flushQueue(options) {
      var opts = options || {};
      if (this.batchTimer) {
        clearTimeout(this.batchTimer);
        this.batchTimer = null;
      }
      if (!this.reportQueue.length) return Promise.resolve(true);

      var records = this.reportQueue.slice();
      this.reportQueue = [];
      return this.sendData(records, opts);
    }

    async sendData(records, options) {
      var opts = options || {};
      if (!records || !records.length) return true;

      // batchId 先于 payload 生成，失败补发时复用同一个，服务端才能幂等去重
      var batchId = opts.batchId || generateId('batch');
      var payload;
      try {
        payload = JSON.stringify(this.buildBatchPayload(records, batchId));
      } catch (error) {
        this.log('Build payload error:', error);
        return false;
      }
      var auth = this.buildAuth(payload);

      try {
        if ((opts.beacon === true || this.isPageHidden()) && this.sendViaBeacon(payload, auth)) {
          this.log('Batch sent via sendBeacon: ' + records.length);
          return true;
        }
        var fetchResult = await this.fetchReport(payload, auth);
        if (fetchResult === true) return true;
        // 4xx 属于永久性失败：服务端已明确拒绝，重试与补发都不可能成功
        if (fetchResult === 'dropped') return true;
        if (await this.xhrReport(payload, auth)) return true;
      } catch (error) {
        this.log('Send data error:', error);
      }

      // 全部通道失败：暂存，下次启动补发（带上 batchId 以复用幂等键）
      if (this.config.persistFailed) this.persistFailedBatch(records, batchId);
      return false;
    }

    // 签名：HMAC-SHA256(secret, appId + '.' + sentAt + '.' + rawBody)
    buildAuth(payload) {
      var appId = this.config.appId;
      if (!appId) return null;
      var sentAt = Date.now();
      var auth = { appId: appId, sentAt: sentAt, sign: '' };
      if (this.config.signSecret) {
        auth.sign = hmacSha256Hex(this.config.signSecret, appId + '.' + sentAt + '.' + payload);
      }
      return auth;
    }

    buildReportHeaders(auth) {
      var headers = { 'Content-Type': this.config.contentType };
      if (auth && auth.sign) {
        headers['X-Track-App-Id'] = auth.appId;
        headers['X-Track-Sent-At'] = String(auth.sentAt);
        headers['X-Track-Sign'] = auth.sign;
      }
      return headers;
    }

    buildBeaconUrl(auth) {
      var url = this.config.serverUrl;
      // sendBeacon 无法设置自定义请求头，鉴权参数只能走 query
      if (!auth || !auth.sign) return url;
      var separator = url.indexOf('?') === -1 ? '?' : '&';
      return (
        url +
        separator +
        'appId=' +
        encodeURIComponent(auth.appId) +
        '&sentAt=' +
        auth.sentAt +
        '&sign=' +
        auth.sign
      );
    }

    // text/plain 属于简单请求，避免跨域预检失败导致数据静默丢失
    sendViaBeacon(payload, auth) {
      var nav = window.navigator;
      if (!nav || typeof nav.sendBeacon !== 'function') return false;

      if (payload.length > MAX_BEACON_BYTES) {
        // payload 已序列化，无法按记录安全拆分，直接降级到 fetch
        this.log('Beacon payload too large, fallback to fetch');
        return false;
      }

      try {
        var BlobRef = window.Blob || (typeof Blob !== 'undefined' ? Blob : null);
        var body = BlobRef ? new BlobRef([payload], { type: this.config.contentType }) : payload;
        var accepted = nav.sendBeacon(this.buildBeaconUrl(auth), body);
        if (!accepted) this.log('sendBeacon rejected the payload');
        return accepted === true;
      } catch (error) {
        this.log('sendBeacon error:', error);
        return false;
      }
    }

    // 返回 true（成功）/ 'dropped'（4xx 永久失败，停止重试）/ false（可重试的失败）
    async fetchReport(payload, auth) {
      var fetchRef = window.fetch;
      if (typeof fetchRef !== 'function') return false;

      for (var attempt = 0; attempt <= this.config.maxRetries; attempt++) {
        try {
          var response = await fetchRef.call(window, this.config.serverUrl, {
            method: 'POST',
            headers: this.buildReportHeaders(auth),
            body: payload,
            keepalive: true,
            credentials: 'omit'
          });
          if (response && response.status >= 200 && response.status < 300) return true;
          var status = response ? response.status : 0;
          if (status >= 400 && status < 500) {
            this.log('Batch rejected by server (HTTP ' + status + '), stop retrying');
            return 'dropped';
          }
          throw new Error('HTTP ' + status);
        } catch (error) {
          this.log('Fetch report error (attempt ' + (attempt + 1) + '):', error);
          if (attempt >= this.config.maxRetries) return false;
          await this.delay(this.backoffDelay(attempt));
        }
      }
      return false;
    }

    // 指数退避 + 抖动，避免大量客户端同时重试造成雪崩
    backoffDelay(attempt) {
      var base = this.config.retryDelay * Math.pow(2, attempt);
      var jitter = 0.5 + Math.random() * 0.5;
      return Math.min(Math.round(base * jitter), MAX_BACKOFF);
    }

    xhrReport(payload, auth) {
      var self = this;
      var XHR = window.XMLHttpRequest;
      if (typeof XHR !== 'function') return Promise.resolve(false);

      return new Promise(function (resolve) {
        try {
          var xhr = new XHR();
          xhr.open('POST', self.config.serverUrl, true);
          var headers = self.buildReportHeaders(auth);
          for (var name in headers) {
            if (Object.prototype.hasOwnProperty.call(headers, name)) {
              xhr.setRequestHeader(name, headers[name]);
            }
          }
          xhr.onload = function () {
            if (xhr.status >= 200 && xhr.status < 300) {
              resolve(true);
              return;
            }
            // 4xx 永久失败：视为已完成，避免进入补发死循环
            if (xhr.status >= 400 && xhr.status < 500) {
              self.log('Batch rejected by server (HTTP ' + xhr.status + ')');
              resolve(true);
              return;
            }
            resolve(false);
          };
          xhr.onerror = function () {
            self.log('XHR report failed');
            resolve(false);
          };
          xhr.send(payload);
        } catch (error) {
          self.log('XHR report error:', error);
          resolve(false);
        }
      });
    }

    delay(ms) {
      return new Promise(function (resolve) {
        setTimeout(resolve, ms);
      });
    }

    /* ---------------------------- 失败补发 ---------------------------- */

    persistFailedBatch(records, batchId) {
      try {
        var storage = this.storage();
        if (!storage) return;
        var list = this.readFailedBatches();
        // 冻结 batchId：补发时复用，服务端才能识别为同一批次
        list.push({ ts: Date.now(), batchId: batchId || generateId('batch'), records: records });
        while (list.length > MAX_FAILED_BATCHES) list.shift();
        storage.setItem(FAILED_KEY, JSON.stringify(list));
      } catch (error) {
        this.log('Persist failed batch error:', error);
      }
    }

    readFailedBatches() {
      try {
        var storage = this.storage();
        if (!storage) return [];
        var raw = storage.getItem(FAILED_KEY);
        if (!raw) return [];
        var list = JSON.parse(raw);
        return Array.isArray(list) ? list : [];
      } catch (error) {
        return [];
      }
    }

    resumeFailedBatches() {
      var self = this;
      var list = this.readFailedBatches();
      if (!list.length) return;
      try {
        var storage = this.storage();
        if (storage) storage.removeItem(FAILED_KEY);
      } catch (error) {
        /* ignore */
      }
      list.forEach(function (item) {
        if (item && Array.isArray(item.records) && item.records.length) {
          // 复用持久化时冻结的 batchId
          self.sendData(item.records, item.batchId ? { batchId: item.batchId } : {});
        }
      });
    }

    /* ---------------------------- 会话 / 存储 ---------------------------- */

    storage() {
      if (this._storage !== undefined) return this._storage;
      var result = null;
      try {
        if (typeof window !== 'undefined' && window.localStorage) {
          window.localStorage.setItem(PROBE_KEY, '1');
          window.localStorage.removeItem(PROBE_KEY);
          result = window.localStorage;
        }
      } catch (error) {
        result = null;
      }
      this._storage = result;
      return result;
    }

    loadSession() {
      var now = Date.now();
      var id = null;
      try {
        var storage = this.storage();
        var raw = storage ? storage.getItem(SESSION_KEY) : null;
        if (raw) {
          var parsed = JSON.parse(raw);
          if (parsed && parsed.id && now - (parsed.lastActive || 0) < SESSION_TIMEOUT) id = parsed.id;
        }
      } catch (error) {
        id = null;
      }

      var session = { id: id || generateId('sess'), lastActive: now };
      this.saveSession(session);
      return session;
    }

    saveSession(session) {
      try {
        var storage = this.storage();
        if (storage) storage.setItem(SESSION_KEY, JSON.stringify(session));
      } catch (error) {
        this.log('Persist session error:', error);
      }
    }

    touchSession() {
      var now = Date.now();
      if (now - this._lastSessionTouch < SESSION_TOUCH_INTERVAL) return;
      this._lastSessionTouch = now;

      // 超过 30 分钟无操作，开启新会话
      if (now - (this.session.lastActive || 0) > SESSION_TIMEOUT) {
        this.session = { id: generateId('sess'), lastActive: now };
      }
      this.session.lastActive = now;
      this.saveSession(this.session);
    }

    readOptOut() {
      try {
        var storage = this.storage();
        return storage ? storage.getItem(OPT_OUT_KEY) === '1' : false;
      } catch (error) {
        return false;
      }
    }

    setOptOut(optedOut) {
      this.optedOut = optedOut === true;
      try {
        var storage = this.storage();
        if (storage) storage.setItem(OPT_OUT_KEY, this.optedOut ? '1' : '0');
      } catch (error) {
        this.log('Persist opt-out error:', error);
      }

      if (this.optedOut) {
        this.reportQueue = [];
        if (this.batchTimer) {
          clearTimeout(this.batchTimer);
          this.batchTimer = null;
        }
      }
      return this.optedOut;
    }

    isOptedOut() {
      return this.optedOut;
    }

    /* ---------------------------- 杂项 ---------------------------- */

    isPageHidden() {
      return !!(window.document && window.document.visibilityState === 'hidden');
    }

    sanitizeUrl(url) {
      var value = url === null || url === undefined ? '' : String(url);
      if (!value || !this.config.urlSanitize) return value;

      var hashIndex = value.indexOf('#');
      if (hashIndex !== -1) value = value.slice(0, hashIndex);

      var queryIndex = value.indexOf('?');
      if (queryIndex === -1) return value;

      var base = value.slice(0, queryIndex);
      var parts = value.slice(queryIndex + 1).split('&');

      for (var i = 0; i < parts.length; i++) {
        if (!parts[i]) continue;
        var eq = parts[i].indexOf('=');
        var key = eq === -1 ? parts[i] : parts[i].slice(0, eq);
        var decoded;
        try {
          decoded = decodeURIComponent(key);
        } catch (error) {
          decoded = key;
        }
        if (SENSITIVE_KEY.test(decoded)) parts[i] = key + '=***';
      }

      return base + '?' + parts.join('&');
    }

    getConfig() {
      var config = {};
      for (var key in this.config) {
        if (Object.prototype.hasOwnProperty.call(this.config, key)) config[key] = this.config[key];
      }
      config.sdkVersion = SDK_VERSION;
      config.sessionId = this.session.id;
      config.sampled = this.sampled;
      config.optedOut = this.optedOut;
      return config;
    }

    // 先校验再赋值，失败时实例保持原配置
    updateConfig(newConfig) {
      var merged = buildConfig(Object.assign({}, this.config, newConfig || {}));
      validateConfig(merged, false);

      var previous = this.config;
      this.config = merged;
      this.sampled = Math.random() < merged.sampleRate;

      var needsRestart =
        previous.autoTrack !== merged.autoTrack ||
        previous.enableErrorTracking !== merged.enableErrorTracking ||
        previous.enableResourceTracking !== merged.enableResourceTracking ||
        previous.enableClickTracking !== merged.enableClickTracking ||
        previous.enabled !== merged.enabled;

      if (needsRestart) {
        this.teardownTracking();
        this.isInitialized = false;
        this.finalReported = false;
        this.init();
      }

      return this.getConfig();
    }

    teardownTracking() {
      this.offAll();
      this.disconnectAllObservers();
      this.restoreHistory();
      if (this.batchTimer) {
        clearTimeout(this.batchTimer);
        this.batchTimer = null;
      }
    }

    cleanup() {
      this.flushQueue();
      this.teardownTracking();
    }

    destroy() {
      if (this.destroyed) return Promise.resolve(true);

      this.reportFinalVitals('destroy');
      var promise = this.flush({ beacon: this.isPageHidden() });

      this.teardownTracking();
      this.isInitialized = false;
      this.destroyed = true;
      if (activeInstance === this) activeInstance = null;
      this.log('TrackerSDK destroyed');
      return promise;
    }

    static getInstance(options) {
      if (activeInstance && !activeInstance.destroyed) return activeInstance;
      return new TrackerSDK(options);
    }
  }

  TrackerSDK.version = SDK_VERSION;

  /* ------------------------------------------------------------------ *
   * 脚本标签接入（loader stub）
   *
   * 页面里只需要：
   *   <script>
   *     window.__trackQueue = window.__trackQueue || [];
   *     window.__trackQueue.push(['init', { appId: 'xxx' }]);   // serverUrl 可省
   *     // 插入 <script id="track-sdk" src="..."> 异步加载
   *   </script>
   * SDK 加载后回放队列并自动初始化；也支持直接用
   * <script id="track-sdk" data-app-id="xxx" src="..."> 免队列初始化，
   * 或用 data-server-url 指定自己的上报地址。
   * ------------------------------------------------------------------ */

  function readCommand(raw) {
    if (!raw || typeof raw !== 'object' || typeof raw.length !== 'number' || !raw.length) return null;
    return { name: String(raw[0] || ''), args: Array.prototype.slice.call(raw, 1) };
  }

  function readScriptOptions(script) {
    if (!script || typeof script.getAttribute !== 'function') return null;
    var serverUrl = script.getAttribute('data-server-url');
    var appId = script.getAttribute('data-app-id');
    if (!serverUrl && !appId) return null;

    var options = {};
    if (serverUrl) options.serverUrl = serverUrl;
    if (appId) options.appId = appId;
    var env = script.getAttribute('data-env');
    if (env) options.env = env;
    return options;
  }

  function dispatchCommand(instance, command) {
    try {
      if (command.name === 'init') {
        instance.updateConfig(command.args[0] || {});
      } else if (command.name === 'track' || command.name === 'trackEvent') {
        instance.track(command.args[0], command.args[1]);
      } else if (command.name === 'flush') {
        instance.flush();
      }
    } catch (error) {
      console.warn('TrackerSDK: 回放队列指令失败:', command.name, error);
    }
  }

  function bootstrapFromPage(Constructor) {
    if (typeof window === 'undefined' || !window.document) return null;
    var page = window;
    var queue = page[GLOBAL_QUEUE_KEY];

    // 已初始化过：重复加载脚本时不要创建第二个实例
    if (queue && queue.instance) return queue.instance;

    var initOptions = null;
    var pending = [];
    if (queue && typeof queue.length === 'number') {
      for (var i = 0; i < queue.length; i += 1) {
        var command = readCommand(queue[i]);
        if (!command) continue;
        if (command.name === 'init') initOptions = command.args[0] || initOptions;
        else pending.push(command);
      }
    }

    if (!initOptions) {
      var script = page.document.currentScript;
      if (!script && typeof page.document.getElementById === 'function') {
        script = page.document.getElementById(SCRIPT_ID);
      }
      initOptions = readScriptOptions(script);
    }
    if (!initOptions) return null;
    // serverUrl 可省（按 SDK 自身域推断），但至少要能确定 appId 或上报地址
    if (!initOptions.appId && !initOptions.serverUrl) return null;

    var instance = new Constructor(initOptions);
    for (var j = 0; j < pending.length; j += 1) dispatchCommand(instance, pending[j]);

    // 队列换成转发器：SDK 加载之后再 push 的指令也能生效
    var forwarder = [];
    forwarder.push = function (raw) {
      var parsed = readCommand(raw);
      if (!parsed) return 0;
      if (parsed.name === 'init') instance.updateConfig(parsed.args[0] || {});
      else dispatchCommand(instance, parsed);
      return 0;
    };
    forwarder.instance = instance;
    page[GLOBAL_QUEUE_KEY] = forwarder;
    return instance;
  }

  bootstrapFromPage(TrackerSDK);

  return TrackerSDK;
});
