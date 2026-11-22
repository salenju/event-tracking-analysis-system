# 用户行为埋点与分析系统 产品需求文档（PRD）V0.1

## 1. 元信息

| 项           | 内容                                                                                                                                                          |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 需求编号     | REQ-100                                                                                                                                                       |
| 文档版本     | V0.1（2026-11-22）                                                                                                                                            |
| 输入依据     | `docs/V0.1 BRD文档-1121.md`、`docs/技术架构设计-V0.1.md`（V0.2 正文及附录 C/D）、`docs/项目结构规划-V0.1.md`，以及 `packages/` 下 SDK / 服务端 / 看板实际代码 |
| 时间口径     | 存储统一 UTC；看板按 `Asia/Shanghai`（北京时间，UTC+08:00）换算后按天/小时分组；签名时间窗 ±300 秒；漏斗相邻步骤窗口 30 分钟                                  |
| 金额口径     | 收银台支付金额单位为 USD，事件必须成对上报 `payAmount` 与 `currency`                                                                                          |
| 本期环境隔离 | `prod` / `test` / `staging` 三值；只有 `env=prod` 的事件进入生产漏斗                                                                                          |

## 2. 背景与目标

公司多个系统需要采集用户行为，此前没有统一的埋点 SDK 与分析系统。本期目标聚焦一件事：**看清买家在收银台各环节的转化率，定位流失环节**。不做通用大型数据分析平台，先验证「埋点 → 漏斗 → 决策」链路，再横向复制到第二个业务。

本期交付范围（已落地的代码能力）：

- Web 前端埋点 SDK：复用 `track-sdk` v2.3.0，做 4 处必要改造，新增脚本标签接入形态。
- 后端通用埋点接口：`POST /api/track`，服务端可直接上报支付成功/失败等事件，不提供多语言 SDK。
- 分析看板：转化漏斗页、事件概览页、体验指标页；漏斗配置为 YAML，新增业务只加配置。
- 看板登录与应用管理：飞书登录、应用颁发/轮换/停用/删除、成员角色管理、一键复制接入代码。

本期明确不做（对应架构文档附录 A，触发条件写在括号中）：

- 实时秒级数据（业务明确要求实时监控且 MySQL 写入延迟不可接受时再评估）。
- Kafka / 消息队列（写入 QPS 超过 500，或接口超时影响交易链路时）。
- Redis 缓存于去重（幂等表超过 1 亿行时）。
- 分群、画像、留存、路径分析（漏斗验证有效且业务提出第二个分析诉求时）。
- 采样（日事件超过 50 万行后为控成本再评估，采样会破坏漏斗准确性）。
- 多场景漏斗（第二个业务接入时，只需加配置与事件字典，不改代码）。

## 3. 用户故事

| 编号   | 角色         | 故事                                                                                                  |
| ------ | ------------ | ----------------------------------------------------------------------------------------------------- |
| US-001 | 运营人员     | 作为运营人员，我希望在漏斗看板看到收银台各环节的会话数与转化率，以便定位流失环节。                    |
| US-002 | 运营人员     | 作为运营人员，我希望点击漏斗某一步查看流失会话的事件序列与 `properties`，以便还原单次收银台会话路径。 |
| US-003 | 运营人员     | 作为运营人员，我希望按时间范围、应用、钱包类型、国家、设备类型筛选漏斗，以便对不同人群做对比。        |
| US-004 | 数据分析人员 | 作为数据分析人员，我希望查看各事件的触发量与独立用户趋势，以便观察事件热度的变化。                    |
| US-005 | 前端开发     | 作为前端开发，我希望粘贴一段 `<script>` 或调用构造函数即可上报事件，以便降低业务系统的接入成本。      |
| US-006 | 后端开发     | 作为后端开发，我希望能用 HTTP 接口上报支付成功与失败事件，以便无需引入多语言 SDK。                    |
| US-007 | 管理员       | 作为管理员，我希望颁发、轮换、停用应用与密钥，以便密钥泄露后立即轮换并隔离单个应用。                  |
| US-008 | 管理员       | 作为管理员，我希望通过飞书登录并维护成员角色，以便控制生产转化数据的访问范围。                        |
| US-009 | 运维人员     | 作为运维人员，我希望查看批次与入库行数的一致性并接收基础告警，以便发现埋点静默失效。                  |
| US-010 | 前端开发     | 作为前端开发，我希望查看页面性能指标与停留时长的分位数，以便定位页面体验问题。                        |

## 4. 业务流程

**FLOW-001 埋点上报链路**：SDK 或后端服务 → `POST /api/track` → 限流（单 IP / 单 appId）→ 验签（appId 白名单、`sentAt` 时间窗、HMAC）→ 按原始 body 解析 JSON 并做批次上限校验 → `event_batches` 幂等插入（冲突返回 200）→ 逐条归一化（`properties` 提升为独立列，非法记录单独跳过）→ `events` 批量插入（与幂等表同事务）→ 返回 200 / 429 / 503。被拒绝的批次写结构化 WARN 日志，保留 7 天，作为人工补导来源。

**FLOW-002 漏斗查询链路**：筛选栏选择时间范围/应用/钱包类型/国家/设备 → `GET /api/funnel` → 按 `session_id` 去重、按 `occurred_at` 升序校验步骤顺序与相邻窗口 → 返回各步会话数与转化率 → 漏斗图与分步表格 → 点击「查看流失」拉 `GET /api/funnel/sessions` → 点击单个会话拉 `GET /api/funnel/session/:sessionId` 展示事件时间线。

**FLOW-003 登录与应用管理链路**：登录页获取飞书授权地址与一次性 `state` → 扫码（iframe 内 `postMessage` 回传 token）或授权跳转（URL fragment 携带 token）→ 前端用 `Authorization: Bearer` 调 `/api/auth/me` 换取用户信息 → 管理员进入 `/admin` 创建应用（明文密钥仅显示一次）→ 复制脚本标签接入代码 → 接入方页面加载 SDK 并开始上报。

## 5. 业务规则

| 编号   | 规则                                                                                                                                                                                                                                                                                                            |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| BR-001 | 业务事件名固定 6 个且使用 `snake_case`：`cashier_view`、`wallet_select`、`wallet_connected`、`pay_click`、`pay_success`、`pay_failed`；`properties` 字段使用 `camelCase`。漏斗配置引用未登记事件名时启动报错。                                                                                                  |
| BR-002 | 漏斗统计主体为 `session_id`；同一会话内各步骤按 `occurred_at` 升序出现即算推进；相邻步骤间隔不超过 30 分钟；不支持跨会话转化（当日进入、次日支付不计入转化）；同一步骤重复触发按 `COUNT(DISTINCT session_id)` 计 1 次。                                                                                         |
| BR-003 | 漏斗只统计 `record_type='event'`、`event IS NOT NULL`、`env='prod'` 的记录；指标包含每步到达会话数、相对上一步转化率、相对首步总转化率、相对上一步流失数。                                                                                                                                                      |
| BR-004 | 返回码契约：正常入库与重复批次返回 200；未授权 appId、签名失败、时间窗超时、JSON 非法、body 超限、单条字段非法均返回 200 并丢弃（附 WARN 日志）；限流返回 429；DB 不可用或写入超时返回 503。                                                                                                                    |
| BR-005 | `event_batches` 以 `batch_id` 为主键做幂等；批次表与事件表在同一事务提交；同一 `batch_id` 重复上报直接返回 200，不返回 409。                                                                                                                                                                                    |
| BR-006 | 单请求 body 不超过 256 KB，单批记录数不超过 50 条，单条 `data` 不超过 16 KB；body 与批次超限整批丢弃并记 WARN 日志（含 body 前 2 KB 摘要），单条超限仅丢弃该条。                                                                                                                                                |
| BR-007 | 签名算法为 `HMAC_SHA256(secret, appId + "." + sentAt + "." + rawBody)`，输出小写 hex；服务端校验时间窗 ±300 秒并用 `timingSafeEqual` 比对。脚本标签接入形态不带签名，服务端须设 `SIGN_REQUIRED=false`。                                                                                                         |
| BR-008 | 限流阈值：单 IP 600 请求/分钟，单 appId 3000 请求/分钟；超限返回 429，由客户端重试。                                                                                                                                                                                                                            |
| BR-009 | `env` 判定优先级为：报文字段 → 按 `appId` 查 `analytics_apps.env` → 服务端 `TRACK_ENV`；接入方无需在 SDK 中传 `env`。                                                                                                                                                                                           |
| BR-010 | 应用 `appId` 为纯随机 `app-` + 12 位 hex，不含业务命名；`secret` 为 48 位 hex，仅在创建与轮换时明文返回一次，列表接口只回掩码；同一 `env` 下应用名不可重复（冲突返回 409）；停用后验签按 `unknown_app_id` 处理；删除为物理删除，历史事件保留。                                                                  |
| BR-011 | 飞书登录的 `state` 为 32 位 hex，有效期 5 分钟且一次性消费；会话 token 为 32 字节随机 base64url，库里只存 SHA-256，默认有效期 168 小时；角色分 `admin` / `viewer`，判定顺序为 `ADMIN_BOOTSTRAP_OPEN_IDS` 白名单 → 库中无可用管理员时首个登录者自动成为管理员 → 其余为 `viewer`；用户停用后已有 token 立即失效。 |
| BR-012 | 禁止上报字段：银行卡号、CVV、完整邮箱与手机号、身份证号、私钥与助记词、URL query 中的 token；钱包地址允许上报但展示时截断。服务端按黑名单过滤，前端上报规范同步约束。                                                                                                                                           |
| BR-013 | 国家码统一归一化为 ISO 3166-1 alpha-2，兼容 `CN`、`cn`、`CN,Beijing`、`CN-Beijing` 四种形态，非法值写 NULL；客户端 IP 依次取 `x-real-ip`、`x-forwarded-for`、`x-client-ip`；服务端不做 GeoIP 反查。                                                                                                             |
| BR-014 | 性能指标只统计 `record_type='performance'` 且 `stage='final'` 的会话；分位数用 `ROW_NUMBER` + `CEIL(total * p)` 取第 N 个值（非插值分位）；CLS 为无量纲 `score`，不与毫秒指标混排；停留时长只统计 `page_stay`，SDK 对不足 1 秒的片段不上报，`stayTime` 为可见态分段而非墙钟时间。                               |
| BR-015 | 数据量假设：收银台日访问订单不超过 2000 单，单订单不超过 10 条事件，日事件行不超过 20000 行，写入峰值 QPS 低于 20，7 天漏斗扫描不超过 20 万行；触发阈值见非功能需求章节。                                                                                                                                       |
| BR-016 | 脚本标签接入时 `serverUrl` 可省略（按 SDK 自身 `<script>` 所在域推断 `/api/track`），`env` 可省略（服务端按 appId 查环境）；显式传 `serverUrl` 指向自有采集地址时，本看板不再收到该批数据。                                                                                                                     |
| BR-017 | 漏斗定义在 `packages/track-server/config/funnels.yaml` 配置：有序 `steps` 数组 + `filters` + `windowMinutes`；第二个业务接入时新增一段配置，不改代码。                                                                                                                                                          |

## 6. 数据规则

| 表                  | 用途                                 | 关键字段                                                                                                                                                                                 |
| ------------------- | ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `event_batches`     | 批次幂等与批次级上下文               | `batch_id`（主键）、`app_id`、`env`、`record_count`、`received_at`；批次级维度 `ip`、`country`、`region`、`ua`、`device_type`、`os`、`browser`、`url_path`、`referrer`、`lang`           |
| `events`            | 一条记录一行                         | `id`（自增）、`batch_id`、`app_id`、`env`、`record_type`、`event`、`user_id`、`session_id`、`order_id`、`wallet_type`、`fail_reason`、`properties`（JSON）、`occurred_at`、`received_at` |
| `events` 生成列     | 从 `properties` 物化，写入代码零改动 | `perf_stage`、`fcp_ms`、`lcp_ms`、`ttfb_ms`、`load_ms`、`inp_ms`、`cls_score`、`stay_ms`                                                                                                 |
| `analytics_apps`    | 应用凭据与环境归属                   | `app_id`（主键）、`name`、`secret`、`env`、`status`、`remark`、`created_by`                                                                                                              |
| `admin_users`       | 看板用户                             | `feishu_open_id`、`user_id`、`name`、`role`（admin/viewer）、`status`、`source`（feishu/local）                                                                                          |
| `admin_sessions`    | 登录会话                             | `token_hash`（SHA-256，主键）、`user_id`、`expires_at`                                                                                                                                   |
| `auth_login_states` | 飞书回调一次性 state                 | `state`（主键）、`mode`（qr/redirect）、`expires_at`                                                                                                                                     |
| `schema_migrations` | 迁移版本记录                         | 由迁移脚本自动创建，按 `.up.sql` 文件名排序执行                                                                                                                                          |

索引与查询约束：

- `events` 建 `idx_app_event_time (app_id, env, event, occurred_at)`、`idx_session_event (session_id, event, occurred_at)`、`idx_batch (batch_id)`；`wallet_type`、`fail_reason`、`order_id`、`country`、`device_type`、`url_path` 提升为独立列，避免在 JSON 内筛选造成全表扫。
- 所有 `DATETIME` 按 UTC 读写；`occurred_at` 取客户端时间（用于行为时序），`received_at` 取服务端时间（用于趋势与对账）。
- 各 `VARCHAR` 字段与 `properties` 超长必须截断，否则整批插入失败；列宽上限见 `packages/track-server/src/domain/events.ts`。

## 7. 接口清单

| 方法       | 路径                                           | 用途                           |
| ---------- | ---------------------------------------------- | ------------------------------ |
| POST       | `/api/track`                                   | 埋点接收（唯一写入入口，公开） |
| GET        | `/healthz` / `/readyz`                         | 存活检查 / 就绪检查（探 DB）   |
| GET        | `/api/auth/config`                             | 登录页展示方式                 |
| GET        | `/api/auth/feishu/login-url?mode=qr\|redirect` | 获取飞书授权地址与 state       |
| GET        | `/api/auth/feishu/callback`                    | 飞书回调（公开）               |
| GET        | `/api/auth/me`                                 | 当前用户                       |
| POST       | `/api/auth/logout`                             | 退出登录                       |
| POST       | `/api/auth/dev-login`                          | 本地调试登录（生产不可用）     |
| GET / POST | `/api/admin/apps`                              | 应用列表 / 创建应用            |
| PATCH      | `/api/admin/apps/:appId`                       | 改名、改环境、停用启用、改备注 |
| POST       | `/api/admin/apps/:appId/rotate`                | 轮换密钥                       |
| DELETE     | `/api/admin/apps/:appId`                       | 删除应用                       |
| GET        | `/api/admin/users`                             | 成员列表                       |
| PATCH      | `/api/admin/users/:id`                         | 改角色、停用启用               |
| GET        | `/api/meta/funnels`                            | 漏斗列表（前端渲染选择器）     |
| GET        | `/api/funnel`                                  | 漏斗各步会话数与转化率         |
| GET        | `/api/funnel/sessions`                         | 某步流失会话列表（支持分页）   |
| GET        | `/api/funnel/session/:sessionId`               | 单会话完整事件序列             |
| GET        | `/api/overview/events`                         | 事件量 / 独立用户数趋势        |
| GET        | `/api/experience/performance`                  | 性能指标分位数与分组           |
| GET        | `/api/experience/stay`                         | 停留时长分位数与分组           |
| GET        | `/api/meta/integrity`                          | 批次声明条数与实际入库行数对比 |

漏斗接口支持 `key`、`from`、`to`、`appId`、`env`、`walletType`、`country`、`deviceType` 筛选；流失会话另支持 `stepIndex`、`limit`、`offset`；概览接口另支持 `tzOffset`、`events`、`limit`；体验接口支持 `urlPath`。

## 8. 页面与交互

| 路由                        | 页面               | 主要元素                                                                                                                                                                   |
| --------------------------- | ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/funnel`                   | 转化漏斗（默认页） | 4 个指标卡（首步会话、末步会话、整体转化率、最大流失环节）；ECharts 漏斗图；分步转化表（到达会话、相对上一步、总转化率、流失数）；点击色块或「查看流失」打开 SessionDrawer |
| `/overview`                 | 事件概览           | 事件总量、事件种类、峰值时间段；「事件量 / 独立用户」切换的折线趋势图；事件明细表（触发量、占比、独立用户）                                                                |
| `/experience`               | 体验指标           | LCP/FCP/TTFB P75 卡片；6 指标分位数表；按页面/国家/设备的 LCP P75；停留时长分位数与按页面/结束原因分组；数据完整性批次报告                                                 |
| `/admin`                    | 管理后台           | 应用列表与复制 ID / 轮换密钥 / 停用启用 / 删除；新建应用（明文密钥仅一次）；成员角色与状态；一键复制脚本标签接入代码                                                       |
| `/login`、`/login/callback` | 登录               | 飞书二维码 iframe、整页跳转兜底、本地调试登录；回调页接收 token                                                                                                            |

公共筛选栏 `FilterBar`：漏斗、应用、环境、钱包类型、国家、设备类型、时间范围与快捷区间，带查询与重置。会话抽屉 `SessionDrawer`：分页拉取流失会话，点击展开单会话事件时间线，展示 `event`、`recordType`、`walletType`、`failReason`、`orderId` 与 `properties`。

接入代码片段由管理后台生成，形态为 `window.__trackQueue.push(['init', { appId }])` 加 `<script id="track-sdk" src="…">`；接入地址域名由 `PUBLIC_TRACK_BASE_URL` 决定，SDK 静态文件地址由 `SDK_PUBLIC_URL` 决定。

## 9. 异常与边界

| 编号   | 场景                                                | 处理                                                                                                                                             |
| ------ | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| EX-001 | 未知 appId、停用应用、签名错误、`sentAt` 超出时间窗 | 返回 200 + `reason`，丢弃批次并记 WARN 日志，不触发客户端重试                                                                                    |
| EX-002 | JSON 非法、body 超过 256 KB、单批超过 50 条         | 返回 200，整批丢弃；WARN 日志含 body 前 2 KB 摘要                                                                                                |
| EX-003 | 单条记录字段非法或非 event 记录缺 `data.event`      | 仅跳过该条，同批其余记录正常入库，记 `rejected_records` 指标；服务端不假设每条都有 `event`                                                       |
| EX-004 | 触发限流                                            | 返回 429；客户端做 3 次指数退避重试，耗尽后写入 localStorage 下次补发                                                                            |
| EX-005 | DB 不可用或写入超时                                 | 返回 503；客户端重试并本地补发；验签缓存故障时进入 5 秒冷却，用 `APP_SECRETS` 兜底，兜不住则 503                                                 |
| EX-006 | 客户端收到 4xx                                      | SDK 短路：不重试、不持久化；只有 5xx 与网络错误进入重试与补发                                                                                    |
| EX-007 | 服务端已写入但响应丢失，客户端补发                  | SDK 持久化失败批次时冻结 `batchId` 并复用，由服务端幂等去重；SDK 改造上线前，漏斗按 `(session_id, event)` 去重兜底                               |
| EX-008 | 网关缺少 CORS 响应头                                | 服务端必须返回 `Access-Control-Allow-Origin` 白名单与 `Access-Control-Allow-Methods: POST, OPTIONS`；缺失会导致 fetch 读不到状态码、重试逻辑退化 |
| EX-009 | 测试环境数据混入                                    | 按 `env` 隔离，`analytics_apps.env` 为环境归属依据；漏斗固定 `env=prod`                                                                          |
| EX-010 | `WEB_ORIGIN` 与实际访问地址不一致                   | 扫码回调的 `postMessage` 会被浏览器按 origin 丢弃；配置必须与协议、域名、端口完全一致                                                            |
| EX-011 | 飞书凭证未配置                                      | 登录页提示未配置；`AUTH_REQUIRED=false` 时只解析身份不拦截请求                                                                                   |
| EX-012 | 降级最后一个管理员或清空全部管理员                  | 服务端拒绝该操作，保证始终存在可用管理员                                                                                                         |
| EX-013 | 用户被停用后持有旧 token                            | 每次请求都查用户状态，token 立即失效                                                                                                             |
| EX-014 | 同一应用分环境使用相同应用名                        | 应用层校验冲突并返回 409；不同环境允许同名                                                                                                       |
| EX-015 | 批次记录数与实际入库行数不一致                      | `GET /api/meta/integrity` 输出 `missingRecords` 与 `mismatchBatches`，供核查静默丢数据                                                           |

## 10. 验收标准

### AC-001 漏斗展示正确

- 给定 库中存在 `env=prod` 的 5 个漏斗步骤事件，同一 `session_id` 内按 `occurred_at` 升序且相邻间隔不超过 30 分钟；
- 当 运营在漏斗页选择时间范围与应用并点击查询；
- 则 页面按 5 步展示会话数、相对上一步转化率、相对首步总转化率与流失数，且各步会话数等于该筛选条件下该步骤的 `COUNT(DISTINCT session_id)`。

### AC-002 流失会话可下钻

- 给定 某一步存在未进入下一步的会话；
- 当 运营点击该步的「查看流失」，再点击会话列表中的一条；
- 则 抽屉先展示该步流失会话分页列表，再展示所选会话按时间排序的完整事件序列，含 `event`、`recordType`、`walletType`、`failReason`、`orderId` 与 `properties`。

### AC-003 多维筛选生效

- 给定 同一时间区间内存在不同 `walletType`、`country`、`deviceType` 的事件；
- 当 运营在筛选栏任选一个钱包类型、一个国家码与一个设备类型后查询；
- 则 漏斗与概览接口返回值只包含匹配该三项的会话，且筛选条件回显在请求参数中。

### AC-004 事件概览趋势可切换

- 给定 所选区间内至少有两个事件名的数据；
- 当 用户在事件概览页切换「事件量」与「独立用户」；
- 则 折线图按天或小时自动选择粒度并更新序列，事件明细表的触发量占比合计为 100%，独立用户按时间桶去重后求和。

### AC-005 脚本标签接入可用

- 给定 管理员在管理后台创建了一个 `env=prod` 的应用并复制了脚本标签代码；
- 当 接入方页面原样粘贴该代码并触发一次 `track()`；
- 则 SDK 用自身 `<script>` 所在域推断出 `/api/track`，`POST /api/track` 返回 200，且 `events` 表中出现该 `appId` 与对应事件名的记录。

### AC-006 后端上报与返回码契约

- 给定 服务端持有有效 appId 与 secret，且已配置 `SIGN_REQUIRED=true`；
- 当 服务端以原始 JSON body 上报一条 `pay_success`，并分别构造过期 `sentAt`、非法 JSON、超限 body 与 DB 断开四种情况；
- 则 正常上报入库返回 200，过期与非法请求返回 200 且记录 WARN 日志，DB 断开返回 503，限流场景返回 429。

### AC-007 应用凭据可轮换与隔离

- 给定 管理员已创建两个应用，其中一个已停用；
- 当 管理员轮换第一个应用的密钥，并向两个应用分别上报事件；
- 则 第一个应用的新密钥验签通过、旧密钥验签失败，停用应用的请求返回 200 + `unknown_app_id` 且不入库，列表接口只显示掩码密钥。

### AC-008 飞书登录与角色控制

- 给定 飞书自建应用已配置回调地址且库中尚无管理员；
- 当 首个用户完成扫码登录，随后一个 `viewer` 用户访问 `/admin`；
- 则 首个用户被自动授予 `admin` 角色，`viewer` 访问管理接口返回 403，两者退出登录后 Bearer token 均失效。

### AC-009 数据完整性可自检

- 给定 一个批次的 `record_count` 声明为 10 条而实际只入库 8 条；
- 当 运维调用 `GET /api/meta/integrity`；
- 则 响应在 `mismatchBatches` 中列出该批次并给出 `missingRecords=2`。

### AC-010 体验指标按口径出数

- 给定 库中存在 `record_type='performance'` 且 `stage='final'` 的记录，以及不足 1 秒的 `page_stay` 片段；
- 当 用户打开体验指标页；
- 则 LCP/FCP/TTFB/Load/INP 以毫秒展示、CLS 以 `score` 展示，分位数按第 N 个值（非插值）计算，不足 1 秒的停留片段不出现在样本中。

## 11. 权限矩阵

| 路径                                                                                               | 未登录                             | viewer | admin |
| -------------------------------------------------------------------------------------------------- | ---------------------------------- | ------ | ----- |
| `POST /api/track`、`/healthz`、`/readyz`                                                           | 允许                               | 允许   | 允许  |
| `/api/auth/config`、`/api/auth/dev-login`、`/api/auth/feishu/*`                                    | 允许                               | 允许   | 允许  |
| `/api/meta/funnels`、`/api/funnel*`、`/api/overview/*`、`/api/experience/*`、`/api/meta/integrity` | `AUTH_REQUIRED=true` 时 401        | 允许   | 允许  |
| `/api/admin/apps*`、`/api/admin/users*`                                                            | 401                                | 403    | 允许  |
| `/funnel`、`/overview`、`/experience` 页面                                                         | `AUTH_REQUIRED=true` 时跳 `/login` | 允许   | 允许  |
| `/admin` 页面                                                                                      | 跳 `/login`                        | 403    | 允许  |

鉴权统一在 `onRequest` 钩子处理：Bearer token 解析后写入 `request.auth`；`/api/admin/*` 额外校验 `role=admin`。`AUTH_REQUIRED=false` 时只解析身份不拦截。

## 12. 非功能需求

- **隔离**：埋点写入池与查询池分离，`DB_POOL_INGEST=10`、`DB_POOL_QUERY=5`；聚合 SQL 带 `MAX_EXECUTION_TIME(5000)` 提示并有应用层超时兜底；需要更强隔离时用 `START_MODE=ingest|api` 拆成两进程。
- **性能**：查询接口 P95 不超过 2 秒；写入 QPS 低于 20；7 天漏斗查询扫描行数不超过 20 万行。
- **可观测**：`POST /api/track` 5xx 率超过 0.1% 且持续 5 分钟告警；近 1 小时入库量环比下跌超过 50% 告警；`rejected` 计数突增告警。
- **数据保留**：原始事件保留 12 个月，超期按月导出冷存储后删除；提供按 `orderId` / `sessionId` 删除的能力，用于合规申诉与误报数据清理。
- **升级阈值**：`events` 超过 3000 万行、漏斗 P95 超过 2 秒、日事件超过 50 万行时引入按天预聚合表；超过 1 亿行或需要多维自由分析时引入 ClickHouse，接口协议不变。
- **安全边界**：`secret` 明文入库（本期边界为数据库权限）；token 存 `localStorage`（当前看板不加载第三方脚本）；扫码回调 `postMessage` 不校验来源，拿到 token 后必须回服务端换用户信息；签名只提高伪造门槛，真正防线是限流与异常检测。
- **部署**：单进程 `START_MODE=all` 默认；Docker Compose 提供 `mysql:8.0` 与 `track-server`，非 root 容器；看板构建产物由反向代理提供，未纳入本仓编排。

## 13. 依赖与风险

| 项     | 说明                                                                                                          |
| ------ | ------------------------------------------------------------------------------------------------------------- |
| 运行时 | Node.js 20 LTS 及以上；MySQL 8.0；飞书开放平台企业自建应用（含网页应用能力与回调 URL 配置）                   |
| SDK    | `track-sdk` v2.3.0，已内置同步 HMAC-SHA256、Web Vitals、停留时长、失败补发与脚本标签接入                      |
| 前端   | Vue 3 + Element Plus + ECharts；dev 端口 5174，`/api` 代理到 8080；`/sdk/*` 映射到 SDK 产物目录               |
| 风险   | 真实 MySQL 联调尚未执行：SQL 仅做过语法与参数顺序校验，需在有库环境执行一次 `npm run db:migrate` 与真实上报   |
| 风险   | 看板浏览器交互回归尚未执行：已用 dev server + 假接口验证编译与代理链路（页面与 SFC 均返回 200），未做交互回归 |
| 风险   | 脚本标签形态不带签名，防护退化为 appId 白名单 + 限流；必须确认 `SIGN_REQUIRED=false`，否则上报被静默丢弃      |

## 14. 待确认问题

- 架构文档使用 `flylinking-storefront`，而 `config/funnels.yaml` 与 `.env.example` 的 `APP_SECRETS` 使用 `fylinking-storefront`，两者拼写不一致，需确认生产接入采用的 appId 并统一配置。
- 漏斗配置当前指向环境变量中的存量应用；管理后台新颁发的 `app-` + 12 位 hex 应用需要先写入漏斗配置才能在看板看到数据，需确认由谁维护该配置。
- 生产上报独立子域的域名与 HTTPS 证书尚未落实；`PUBLIC_TRACK_BASE_URL` 与 `SDK_PUBLIC_URL` 的生产取值需确认。脚本标签形态按 SDK 自身 `<script>` 所在域推断 `/api/track`，若两者指向不同域名，需改为显式传 `serverUrl`，此时数据将发往配置方而非本看板。
- 网关实际输出的国家码与客户端 IP 请求头名称需按环境核对并写入 `GEO_COUNTRY_HEADERS` / `CLIENT_IP_HEADERS`。
- 真实 MySQL 联调与看板浏览器交互回归的执行时间与责任人需排期。
- 12 个月数据保留的按月导出与删除由谁执行、导出目标位置需明确。
- `APP_SECRETS` 中的存量应用是否迁移到管理后台（迁移后可在页面轮换密钥）需决策。
