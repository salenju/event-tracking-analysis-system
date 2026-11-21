# Changelog

## v2.3.0（2026-11-21）

接入形态收敛：**只配 appId 就能跑**，并移除 `flyway` 命名。

### 变更

- **`serverUrl` 可省**：缺省时按 SDK 自身 `<script>` 所在域推断 `/api/track`（`new URL('/api/track', script.src)`）；连 script 都没有时保留占位地址。显式传入 `serverUrl` 优先级最高，可把数据发到自己的采集端。
- **`env` 可省**：appId 唯一，服务端按 `analytics_apps.env` 判定环境；只有当接入方想覆盖时才需要显式传 `env`。
- **命名去 flyway**：包名 `track-sdk`、源码 `track-sdk.js`、产物 `dist/track-sdk.min.js`、脚本 id `track-sdk`、全局队列 `window.__trackQueue`、localStorage 前缀 `__track_sdk_*`。
  - 升级影响：旧版 `__flywayTrack` 队列与 `__flyway_tracker_*` 本地状态不再读取，会话会重建一次。
- **data-* 初始化放宽**：`<script id="track-sdk" data-app-id="xxx" src="...">` 即可，`data-server-url` 变为可选。

### 兼容性

- 构造函数用法不变（`new TrackerSDK({ serverUrl, appId, env, signSecret })` 仍可用）。
- `serverUrl` 上的 `?appId=&env=` 仍会被解析，老接入方式不受影响。

## v2.2.0（2026-11-21）

脚本标签接入（loader stub），让接入方「复制一段 script 贴进页面」即可上报，不必在构造函数里配 `appId` / `env`。**向后兼容**：不写 URL 参数、不用队列时行为与 2.1.1 完全一致。

### 新增

- **端点自解析**：`serverUrl` 上的 `?appId=&env=` 会被解析为配置，构造函数里的同名参数优先。
- **全局指令队列**：页面可在 SDK 加载前写 `window.__flywayTrack.push(['init', { serverUrl }])` 与 `push(['track', name, props])`；SDK 加载后回放，并把队列替换为转发器（`.instance` 暴露实例）。支持 `init` / `track` / `trackEvent` / `flush` 四种指令。
- **data-* 初始化**：`<script id="flyway-track-sdk" data-server-url="...?appId=&env=" data-env="test" src="...">` 可免队列自动初始化；重复加载脚本时复用已有实例。
- 服务端配套：报文里 `appId` 允许缺省（只认验签结果）、`env` 支持从 query 读取，见 `packages/track-server`。

### 安全说明

脚本标签接入不带签名，需服务端 `SIGN_REQUIRED=false`，防护退化为 appId 白名单 + 限流。需要签名时继续用 `new TrackerSDK({ serverUrl, appId, env, signSecret })`。

## v2.1.1（2026-11-21）

配合埋点服务端（`packages/track-server`）落地，做 4 处必要改造。**不改变已有配置的默认行为**，未设置 `signSecret` / `env` 时上报内容与 2.1.0 一致。

### 新增

- **请求签名**：新增 `signSecret` 配置。设置后每个批次按
  `HMAC-SHA256(secret, appId + '.' + sentAt + '.' + rawBody)` 计算签名。
  - `fetch` / `XHR` 通过 `X-Track-App-Id` / `X-Track-Sent-At` / `X-Track-Sign` 请求头传递；
  - `sendBeacon` 无法设置自定义头，改为在 URL 上追加 `?appId=&sentAt=&sign=`。
  - 内置一份同步 HMAC-SHA256 实现（约 4KB 未压缩 / 2KB gzip），保持单文件零依赖。
- **`env` 配置**：上报体新增顶层 `env` 字段（`test` / `prod`），未配置时不输出，便于服务端隔离测试数据与生产漏斗。

### 修复

- **补发丢失 batchId**：`persistFailedBatch` 现在把 `batchId` 一并冻结，`resumeFailedBatches` 复用之。此前补发会重新生成 batchId，导致"服务端已入库但响应丢失"的场景重复写数据。
- **4xx 无限重试**：`fetchReport` / `xhrReport` 对 4xx 短路——不重试、不落盘补发。此前任何非 2xx 都会重试 3 次并写入 localStorage，遇到服务端永久拒绝（未授权、body 超限、格式非法）会形成跨会话反复失败的补发死循环。

### 行为变化（需要注意）

- `sendData` 的 payload 只构建一次，beacon / fetch / xhr 共享同一份 body 与签名，避免各通道各自 `buildBatchPayload` 造成 batchId 不一致。
- `buildBatchPayload(records)` 新增可选第二参数 `batchId`，不传时行为与旧版一致。
- beacon 载荷超过 `MAX_BEACON_BYTES`（60KB）时不再二分拆包，直接降级到 fetch。原因是 payload 已序列化，字符串二分无法保证 JSON 完整。正常批量（≤10 条）不会触发。

### 测试

新增 `test/signature.test.js`（10 个用例）：签名与 Node `crypto` 一致、中文内容签名、请求头签名、beacon query 降级、4xx 短路、5xx 重试、补发 batchId 复用、`env` 字段。全量 42 个用例通过。

## v2.1.0

见 README「升级说明（v2.0.0 → v2.1.0）」。
