# Changelog

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
