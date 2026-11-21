# TrackerSDK - 前端埋点 SDK

一个功能完整、可自测的前端数据埋点 SDK，支持自动性能监控、用户行为追踪、错误监控与可靠上报。

当前版本：**v2.1.1**（v2.1.0 的兼容升级，新增签名与 env，见 docs/CHANGELOG.md）

## 🚀 主要特性

### 性能监控
- **Web Vitals**：FCP、LCP、INP（同时保留 FID 兼容）、CLS（按最大 session window 计算）
- **导航指标**：TTFB、DNS、TCP、DOM 解析、DOM Ready、Load（基于 `PerformanceNavigationTiming`）
- **长任务监控**：聚合后随最终指标一并上报
- **资源加载监控**（可选）：只收集耗时 > 100ms 的资源

指标分两个阶段上报：
- `stage: "load"` —— 页面 `load` 后上报已确定的导航指标与 FCP；
- `stage: "final"` —— 页面隐藏 / 卸载 / `destroy()` 时上报 LCP、CLS、INP、FID 的最终值。
  这样避免了在指标尚未定型时就把中间态写进数仓。

### 用户行为追踪
- **自动点击追踪**：基于 `data-track` 属性，支持点击元素内部的图标 / `<span>` 子节点
- **页面停留时长**：区分「本段时长」与「累计时长」，不会因监听器顺序重复计数
- **路由变化监控**：包装 `pushState` / `replaceState`，`destroy()` 时完整还原
- **自定义事件**：`track()` / `trackEvent()`，支持 `{ immediate: true }` 立即发送

### 错误监控
- **JS 运行时错误**、**未处理 Promise 拒绝**（兼容 `Promise.reject('字符串')`）、**资源加载失败**
- **去重 + 限流**：相同错误 5 秒内只上报一次，单页最多 50 条，避免渲染循环刷爆队列

### 数据上报
- **批量上报**：达到 `batchSize` 或 `batchTimeout` 触发；公共字段收敛到批次层，避免逐条冗余
- **通道降级**：`sendBeacon`（页面卸载时）→ `fetch`（指数退避 + 抖动重试）→ `XHR`
- **失败补发**：全部通道失败后写入 `localStorage`，下次启动自动补发
- **快照入队**：入队时序列化，指标对象后续变化不会污染已入队数据

### 高级特性
- **采样**：`sampleRate` 支持 `0`，且采样判断下沉到 `report()`，手动事件同样受控
- **会话管理**：`sessionId` 持久化到 `localStorage`，30 分钟无操作自动续期
- **隐私**：URL 敏感参数自动脱敏；支持 `setOptOut()` 且状态持久化
- **生命周期**：`destroy()` 移除全部监听器、断开 observer、还原 history、清空定时器
- **多实例保护**：`TrackerSDK.getInstance()` 复用实例，重复 `new` 会给出告警
- **模块形态**：UMD（CommonJS / AMD / 浏览器全局），并提供压缩产物

## 📦 安装与引入

### 浏览器直接引入
```html
<!-- 开发调试 -->
<script src="./flyway-track-sdk.js"></script>
<!-- 生产（推荐压缩版） -->
<script src="./dist/flyway-track-sdk.min.js"></script>
```

三种形态均可用：
```javascript
// 1. 经典脚本：全局变量
const tracker = new TrackerSDK({ serverUrl, appId });

// 2. CommonJS
const TrackerSDK = require('flyway-track-sdk');

// 3. 打包器（ESM 互操作）
import TrackerSDK from 'flyway-track-sdk';
```

### 基础初始化
```javascript
const tracker = new TrackerSDK({
    serverUrl: 'https://your-analytics-server.com/api/track',
    appId: 'your-app-id',
    userId: 'user-123',
    debug: false,
});
```

### 完整配置
```javascript
const tracker = new TrackerSDK({
    // 必需
    serverUrl: 'https://your-analytics-server.com/api/track',
    appId: 'your-app-id',

    // 用户标识
    userId: 'user-123',

    // 功能开关
    autoTrack: true,               // 性能 + 页面停留（默认 true）
    enableClickTracking: true,     // data-track 自动点击（默认 true）
    enableErrorTracking: true,     // 错误监控（默认 true）
    enableResourceTracking: false, // 资源监控（默认 false）

    // 上报配置
    batchSize: 10,                 // 批量大小，>= 1
    batchTimeout: 5000,            // 批量超时(ms)，0 表示下一个事件就发
    maxRetries: 3,                 // 最大重试次数，0 表示不重试
    retryDelay: 1000,              // 重试基础延迟(ms)，实际为指数退避 + 抖动
    maxQueueSize: 200,             // 内存队列上限，超出丢弃最旧数据
    contentType: 'text/plain;charset=UTF-8', // 见「服务端对接」
    persistFailed: true,           // 失败数据落盘、下次启动补发

    // 采样与开关
    sampleRate: 1,                 // 0-1，0 = 完全不上报
    enabled: true,                 // 总开关

    // 隐私
    urlSanitize: true,             // URL 敏感参数脱敏

    // 调试（注意：debug 只多打日志，不影响上报）
    debug: false,
});
```

> 配置项会做严格类型校验：`sampleRate: 'abc'` 会直接抛错，而不是静默回退成默认值；`0` 是合法值，不会被 `||` 覆盖。

## 🎯 使用方法

### 自动点击追踪
```html
<button data-track="login_button">登录</button>
<a data-track="nav_link_home" href="/home">首页</a>
<div data-track="card_click" class="product-card">
    <svg class="icon">...</svg> <!-- 点击图标同样能命中 div 上的 data-track -->
</div>
```

### 手动事件追踪
```javascript
// 推荐
tracker.track('purchase_complete', {
    orderId: 'order-123',
    amount: 99.99,
    currency: 'USD',
});

// 立即发送（跳过批量等待）
tracker.track('pay_success', { orderId: 'order-123' }, { immediate: true });

// 与 track 等价，数据结构完全一致
tracker.trackEvent('button_click', { buttonName: '提交订单' });
```

### 页面 / 业务事件
```javascript
tracker.track('page_view', { page: '/products', title: '产品列表' });
tracker.track('search', { keyword: 'javascript sdk', resultsCount: 156 });
```

### 用户登录后更新身份
```javascript
tracker.updateConfig({ userId: 'user-456' });
```

### 隐私控制
```javascript
tracker.setOptOut(true);   // 立即停止采集，状态写入 localStorage
tracker.isOptedOut();      // true
tracker.setOptOut(false);  // 恢复
```

## 📊 数据格式

公共字段只出现一次，位于批次层；批量明细在 `batch` 数组中。

```javascript
{
    appId: 'your-app-id',
    sdkVersion: '2.1.1',
    userId: 'user-123',
    sessionId: 'sess_1750000000000_ab12cd34e',
    batchId: 'batch_1750000000500_xy98zw76q',
    sentAt: 1750000000500,

    context: {
        url: 'https://example.com/page?token=***&id=42', // 敏感参数已打码、hash 已去除
        referrer: '',
        title: '产品列表',
        userAgent: 'Mozilla/5.0 ...',
        language: 'zh-CN',
        screen: { width: 1920, height: 1080 },
        viewport: { width: 1200, height: 800 },
        devicePixelRatio: 2
    },

    batch: [
        { type: 'event', timestamp: 1750000000100, data: { event: 'login_button', properties: { /* ... */ } } }
    ]
}
```

各 `type` 的 `data`：

| type | data 结构 |
|---|---|
| `event` | `{ event, properties }` |
| `performance` | `stage: 'load'`：`{ ttfb, dnsTime, tcpTime, domInteractive, domParseTime, domReadyTime, loadTime, fcp }`<br>`stage: 'final'`：`{ fcp, lcp, cls, inp, fid, longTaskCount, longTaskTotal, longTasks, resources, trigger }` |
| `page_stay` | `{ stayTime, totalStayTime, trigger, page, referrer }`，`trigger` 为 `hidden` / `beforeunload` / `pagehide` / `route_change` |
| `error` | `{ type, message, filename, lineno, colno, stack }` / `{ type: 'promise', message, name, stack }` / `{ type: 'resource', message, source }` |

## 🔧 API 参考

| 方法 | 说明 |
|---|---|
| `track(name, properties, options)` | 上报业务事件；`options.immediate` 为 true 时立即 flush |
| `trackEvent(name, properties)` | 同上，无 `immediate` |
| `flush(options)` | 立即发送队列；`{ beacon: true }` 强制走 sendBeacon |
| `report(type, data)` | 上报自定义类型（`data` 入队时做快照） |
| `updateConfig(partial)` | 合并配置；先校验后赋值，校验失败不污染原配置；切换功能开关会自动重建监听 |
| `getConfig()` | 返回配置副本 + `sdkVersion` / `sessionId` / `sampled` / `optedOut` |
| `setOptOut(bool)` / `isOptedOut()` | 退出/恢复采集，状态持久化 |
| `destroy()` | 上报最终指标、flush、移除监听、断开 observer、还原 history |
| `TrackerSDK.getInstance(options)` | 复用已有实例，避免重复注册 |
| `TrackerSDK.version` | SDK 版本号 |

## 🖥 服务端对接

1. **Content-Type**：默认 `text/plain;charset=UTF-8`。这是简单请求，跨域时**不触发 CORS 预检**，避免 `sendBeacon` 在页面卸载期间因预检失败而静默丢数据。服务端请按**原始请求体**解析 JSON，不要依赖 `Content-Type` 判断。
2. **CORS**：服务端需返回 `Access-Control-Allow-Origin`，并允许 `POST`。
3. **幂等**：同一批次可能有重复投递（重试 / 卸载时补发），请用 `batchId` 去重。
4. **补发**：客户端失败数据存放在 `localStorage` 的 `__flyway_tracker_failed__`，最多 5 个批次。

## 🧪 构建与测试

```bash
npm install
npm test                 # 32 个单测（零依赖，node:test）
npm run lint             # ESLint
npm run build            # terser 压缩到 dist/flyway-track-sdk.min.js
SDK_ENTRY=dist/flyway-track-sdk.min.js npm test   # 对压缩产物跑同一套用例
```

单测覆盖：采样 / 配置校验 / immediate / debug 上报 / 点击子元素命中 / 去重 / 快照 / 脱敏 /
opt-out / destroy 清理 / 停留时长不重复 / 指标阶段与 CLS 算法 / INP / 重试降级 / 落盘补发 / 会话持久化 / UMD。

## 🐛 调试

```javascript
const tracker = new TrackerSDK({ debug: true /* ... */ });
```

控制台输出：`[TrackerSDK] TrackerSDK 2.1.1 initialized successfully`、`Reporting <type>:`、`Batch sent via sendBeacon:`。

`debug` 仅控制日志输出，**不会**改变上报行为。

## ⚠️ 已知限制

- Web Vitals 的 `final` 数据依赖 `visibilitychange` / `pagehide`，长时间不隐藏的标签页不会有最终指标；
- 长任务与资源明细改为在 `final` 阶段聚合上报，牺牲了实时性以换取更少请求；
- `sendBeacon` 返回 `true` 只代表浏览器已接受入队，不代表服务端已成功入库；常规时段走 `fetch` 才能拿到 HTTP 状态；
- 采样在实例创建时决定，运行期修改 `sampleRate` 后重新掷骰。

## 📄 更新日志

### v2.1.0
- 🐛 修复 `sampleRate: 0` / `batchSize: 0` 等配置被 `||` 覆盖成默认值的问题；类型非法直接抛错
- 🐛 采样判断下沉到 `report()`，手动 `track` 不再绕过采样
- 🐛 实现 `track(..., { immediate: true })`
- 🐛 点击埋点改用向上查找 `[data-track]`，取消节流；修复 SVG 子元素导致整条事件丢失
- 🐛 `destroy()` 移除全部监听器、断开 observer、还原 history 包装
- 🐛 修复 `beforeunload` 与 `visibilitychange` 重复累加停留时长；统一 `stayTime` / `totalStayTime` 口径
- 🐛 修复 `debug: true` 时数据完全不发送的问题
- 🐛 导航指标改在 `load` 后采集，使用 `PerformanceNavigationTiming`；不再出现负数 `loadTime`
- ✨ 新增 INP，CLS 改为最大 session window 算法；指标分 `load` / `final` 两阶段上报
- ✨ 入队快照、批次级公共字段、`sdkVersion`、会话持久化、URL 脱敏、opt-out
- ✨ 指数退避 + 抖动重试、XHR 降级、失败落盘与启动补发
- ✨ UMD 导出、压缩产物、ESLint 配置、32 个单测

### v2.0.0
- 新增 Web Vitals、错误监控、批量上报、智能重试、长任务监控

## 升级说明（v2.0.0 → v2.1.0）

破坏性变更，接入方与数仓需同步调整：

1. 公共字段（`appId` / `userId` / `sessionId` / `url` / `userAgent` / `screen` / `viewport`）从**每条记录**移到**批次**的顶层与 `context`；
2. `trackEvent(name, payload)` 的 payload 现在统一收进 `properties`，与 `track` 结构一致；
3. 默认 `Content-Type` 由 `application/json` 改为 `text/plain;charset=UTF-8`；
4. 性能数据由「一次全量」改为 `stage: 'load'` 与 `stage: 'final'` 两次上报；
5. 长任务与资源明细改为 `final` 阶段聚合上报，不再每次观察都上报。

## 🤝 贡献 / 📄 许可证

欢迎提交 Issue 和 Pull Request。MIT License。
