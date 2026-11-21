# TrackerSDK 代码 Review 与优化建议

> 审阅日期：2026-11-21
> 审阅范围：`README.md`、`flyway-track-sdk.js`（710 行）、`package.json`、`example.html`、`demo.html`
> 说明：本文按优先级列出可优化点，每个问题包含代码位置、影响与修复建议。

## 总体评价

功能覆盖面较广（性能监控、行为追踪、错误监控、批量上报、重试降级），README 描述完整。但实现层面存在若干会**实际影响数据准确性与稳定性**的缺陷：采样配置失效、`immediate` 参数未实现、点击埋点丢事件/漏采、`destroy()` 内存泄漏、现代指标上报时机过早、上报链路的 CORS 与重试策略问题等。建议优先处理 P0，再逐步推进 P1/P2。

---

## P0：会导致功能失效或数据错误的 Bug

### 1. `sampleRate: 0` 完全失效（采样率被覆盖成 1）

```16:16:前端埋点SDK-20250803/flyway-track-sdk.js
      sampleRate: options.sampleRate || 1, // 采样率 (0-1)
```

用 `||` 导致 `0`（0% 采样）被当成默认值 `1`（100% 全量上报）。同理 `batchSize: 0` 也无法设置。应改用 `??`。另外第 41–43 行的范围校验只比大小、不校验类型：传 `"abc"` 时 `NaN` 能通过校验，结果是 `Math.random() < NaN` 恒为 false，SDK 静默不上报且无任何提示。

### 2. 采样只在初始化时判断，手动事件绕过采样

`init()` 里 `shouldSample()` 不通过就直接 return（第 85–89 行），但公开的 `trackEvent()` / `track()`（第 414–438 行）仍然无条件 `report()`。结果是采样不通过时，自动点击不采、手动 `track` 照发，采样形同虚设。采样判断应下沉到 `report()` 统一处理。

### 3. `track(..., { immediate: true })` 是死参数

README 第 205–214 行明确承诺 `immediate: true` 立即发送，但第 432–438 行只是把 `options` 塞进 payload，`report` / `addToQueue` 全程没有读取它。文档与实现不符。

### 4. 点击埋点会丢事件、漏采子元素

```442:446:前端埋点SDK-20250803/flyway-track-sdk.js
    const clickHandler = this.throttle((e) => {
      try {
        const target = e.target;
        const trackAttribute = target.getAttribute('data-track');
```

- `throttle(…, 100)` 会吞掉 100ms 内的第二次点击，埋点应全量采集而非节流；
- 只看 `e.target` 自身，点击按钮里的 `<span>` / 图标时 target 是子元素，没有 `data-track` 就漏采。

建议改为 `e.target.closest('[data-track]')` 并去掉节流（或改用更宽松的兜底窗口）。

### 5. `destroy()` 不移除任何监听器、不还原 history 包装 —— 内存泄漏 + 重复上报

`cleanup()`（第 667–687 行）只做了 flush、清 timer、disconnect observer，但 `init()` / `setupPageStayTime()` / `setupErrorTracking()` / `setupClickTracking()` 注册的 `beforeunload`、`error`、`unhandledrejection`、`visibilitychange`、`popstate`、`click`、`load` 全是匿名函数且从未移除；`wrapHistoryMethod()`（第 391–400 行）包装的 `pushState` / `replaceState` 也没还原。后果：

- `destroy()` 后事件仍在触发，继续上报；
- 多次 `new TrackerSDK()` 会重复注册 + 链式包装 history，同一事件被多个实例重复上报。

需要保存所有监听器引用和原始 history 方法，`destroy()` 时逐一移除/还原，并考虑做单例保护。

### 6. `beforeunload` 双监听器竞态，最后一段停留时长可能丢失

`init()` 第 107 行注册了 `cleanup`（会 flush 并清掉 timer），`setupPageStayTime()` 第 382 行又注册了 `handleBeforeUnload`（会 `addToQueue`）。若 cleanup 先执行，最后一段停留数据入队后没有 timer、没有再次 flush，直接丢失。两个 handler 应合并为一个有序流程。

---

## P1：数据准确性与可靠性缺陷

### 7. 现代指标上报过早，LCP / CLS / FID 基本不准

`reportBasicMetrics()` 在 `window.load` 后 `setTimeout(0)` 就把 `performanceMetrics` 上报一次（第 135–141、253–257 行）然后结束。但 LCP 要到用户首次交互才定型、CLS 会持续累加到页面隐藏、FID 依赖首次输入——此时上报的值几乎肯定是中间态，后续变化全部丢失。应在 `visibilitychange:hidden` / 首次交互时上报最终值，并在交互后停止 LCP / CLS observer。

### 8. FID 已被 INP 取代

Google 2024 年起用 INP 替换 FID 作为核心 Web Vitals，README 仍停在 FID。建议补 `event` observer 计算 INP，保留 FID 仅作兼容。

### 9. 使用废弃的 `performance.timing`

`collectNavigationTiming()`（第 148–170 行）用的是已废弃的 `PerformanceTiming`，应改用 `performance.getEntriesByType('navigation')[0]`（`PerformanceNavigationTiming`），精度与字段也更规范。`whiteScreenTime` 的“估算”口径容易误导。

### 10. 上报的是共享引用，不是快照

`report('performance', this.performanceMetrics)` 把对象引用放进队列，真正 `JSON.stringify` 发生在数秒后 `flushQueue` 时（第 575 行），期间 observer 可能已更新该对象，上报的是“最新值”而非触发时刻的值。入队时应做一次快照/序列化。

### 11. `sendBeacon` 的 CORS 预检 + 成功语义问题

```581:590:前端埋点SDK-20250803/flyway-track-sdk.js
      if (navigator.sendBeacon && this.config.serverUrl) {
        const blob = new Blob([payload], { type: 'application/json' });
        const success = navigator.sendBeacon(this.config.serverUrl, blob);
```

- `application/json` 属于非简单请求，跨域时会触发 CORS 预检，预检失败则数据静默丢失（埋点 SDK 通常用 `text/plain` 或 `URLSearchParams` 规避）；
- `sendBeacon` 返回 `true` 只代表浏览器已入队，**不代表服务端成功接收**，无法据此宣称“确保数据不丢失”。

### 12. 重试策略粗糙，且失败即丢

`fetchReport()`（第 622–625 行）用线性退避 `retryDelay * (retryCount+1)`，无随机抖动，大量客户端同时失败会雪崩；末级 XHR 降级（第 628 行）没有重试；重试耗尽后 `resolve(false)`，数据直接丢弃、不回队列——与 README“失败重试确保数据不丢失”不符。建议指数退避 + jitter，并考虑失败数据暂存（sessionStorage / localStorage）下次补发。

### 13. 会话 ID 刷新即变、不持久化

`generateSessionId()`（第 46–49 行）每次实例化都新建，刷新页面就换，没有存 `sessionStorage`、没有超时续期，会话级分析基本失效。建议会话持久化 + 30 分钟无操作过期。

### 14. 无 SDK 版本号上报

上报数据里没有 `sdkVersion`，服务端无法区分数据来自哪个版本，升级导致口径变化时无法追溯。

---

## P2：工程化与体验优化

| # | 位置 | 问题与建议 |
|---|---|---|
| 15 | `report()` 第 504–521 行 | 每条事件都重复携带 `userAgent` / `screen` / `viewport` / `userId`，批量内冗余极大、浪费带宽。建议公共字段提到 batch 层或会话级缓存，UA 也可由服务端从请求头取。 |
| 16 | `report()` 第 510 行 | `url: location.href` 未脱敏，query 里可能带 token / 手机号。README 声称“支持用户选择退出追踪”，但代码没有任何 opt-out 开关，需补 `enabled` / `setOptOut`。 |
| 17 | 文件末尾 | 无 `export`、无 `window.TrackerSDK = …`、无 UMD 包装。经典脚本下靠顶层 class 的词法绑定碰巧可用，但 `type="module"` 或打包引入会直接拿不到，建议补 UMD / ESM 双导出。 |
| 18 | `package.json` | 直接分发未转译源码，却用了 `?.` / class / async，`browserslist` 又承诺 “last 2 versions / not dead”，缺构建产物和 min 版；埋点脚本通常对体积敏感。 |
| 19 | 第 56–79、659 行 | `debounce()` 定义后从未使用（死代码）；`substr()` 已废弃，改 `slice()`。 |
| 20 | `package.json` 第 13 行 | `npm test` 直接 `exit 1`，零测试。作为要嵌进业务的 SDK，采样 / 重试 / 队列 / 停留时长都该有单测。 |
| 21 | `log()` 第 118–123 行 | debug=false 时所有错误（发送失败、observer 创建失败）完全静默，生产问题无感知。关键失败建议采样上报或提供 hook。 |
| 22 | `reportError()` 第 274–280 行 | 错误无去重 / 限流，高频错误（如渲染循环抛错）会瞬间刷爆队列；`Promise.reject('字符串')` 时 reason 无 message / stack，信息丢失，应处理原始值。 |
| 23 | `track()` vs `trackEvent()` 第 415–438 行 | 两者 payload 结构不一致：前者把字段塞进 `properties` / `options` 嵌套，后者是平铺的，容易让接入方混淆。 |
| 24 | `updateConfig()` 第 700–703 行 | 浅合并且改 `autoTrack` / `sampleRate` 后不会重新初始化；`getConfig()` 是浅拷贝。 |

---

## 建议的落地顺序

1. **先修 P0 的 6 个**（尤其采样 `||`、destroy 泄漏、点击漏采）——都是正确性 bug，改动小、收益大。
2. **再处理 P1 的指标上报时机**（`visibilitychange` 最终上报）和**上报链路**（Beacon content-type、退避策略）——直接影响数据可信度。
3. **P2 优先补** `sdkVersion`、会话持久化、UMD 导出和最小单测，其余按排期渐进。
