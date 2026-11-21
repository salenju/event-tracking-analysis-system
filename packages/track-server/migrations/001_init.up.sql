-- 幂等表：一个批次一行。
-- 注意：不能把唯一索引直接建在 events.batch_id 上——一个 batch 展开是多行，
-- batch_id 相同会让每批只写进 1 条，其余被唯一键顶掉。
CREATE TABLE IF NOT EXISTS event_batches (
  batch_id     VARCHAR(64)  NOT NULL,
  app_id       VARCHAR(64)  NOT NULL,
  env          VARCHAR(16)  NOT NULL,
  record_count INT          NOT NULL,
  received_at  DATETIME(3)  NOT NULL,
  PRIMARY KEY (batch_id),
  KEY idx_app_time (app_id, env, received_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='埋点批次幂等表';

CREATE TABLE IF NOT EXISTS events (
  id          BIGINT AUTO_INCREMENT PRIMARY KEY,
  batch_id    VARCHAR(64)  NOT NULL,
  app_id      VARCHAR(64)  NOT NULL,
  env         VARCHAR(16)  NOT NULL COMMENT 'prod / test，防止测试数据污染生产漏斗',
  record_type VARCHAR(16)  NOT NULL DEFAULT 'event' COMMENT 'event / performance / page_stay / error',
  `event`     VARCHAR(64)  NULL COMMENT '非 event 类型为 NULL',
  user_id     VARCHAR(64)  NULL,
  session_id  VARCHAR(64)  NOT NULL,
  order_id    VARCHAR(64)  NULL COMMENT '从 properties 提取，用于订单级排查',
  wallet_type VARCHAR(32)  NULL COMMENT '从 properties 提取，漏斗筛选维度',
  fail_reason VARCHAR(64)  NULL COMMENT '从 properties 提取，流失归因',
  properties  JSON         NULL,
  occurred_at DATETIME(3)  NOT NULL COMMENT '客户端时间，UTC',
  received_at DATETIME(3)  NOT NULL COMMENT '服务端时间，UTC',
  KEY idx_app_event_time (app_id, env, `event`, occurred_at),
  KEY idx_session_event  (session_id, `event`, occurred_at),
  KEY idx_batch          (batch_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='埋点事件明细';
