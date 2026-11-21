-- 002：补齐统计分析维度
-- 1) 批次级上下文（UA / 来源 / IP / 国家）此前被整包丢弃，这里落库
-- 2) 事件表冗余 country / device_type / url_path，用于漏斗与概览的高频筛选
-- 3) 性能与停留时长用生成列暴露，查询侧不必每次解析 JSON（写入代码零改动）

ALTER TABLE event_batches
  ADD COLUMN ip          VARCHAR(45)  NULL COMMENT '客户端 IP，来自网关透传' AFTER record_count,
  ADD COLUMN country     CHAR(2)      NULL COMMENT 'ISO 3166-1 alpha-2，来自网关地理头' AFTER ip,
  ADD COLUMN region      VARCHAR(64)  NULL COMMENT '省/州，来自网关地理头' AFTER country,
  ADD COLUMN ua          VARCHAR(512) NULL COMMENT '原始 User-Agent' AFTER region,
  ADD COLUMN device_type VARCHAR(16)  NULL COMMENT 'desktop / mobile / tablet' AFTER ua,
  ADD COLUMN os          VARCHAR(32)  NULL AFTER device_type,
  ADD COLUMN browser     VARCHAR(32)  NULL AFTER os,
  ADD COLUMN url_path    VARCHAR(255) NULL COMMENT '页面路径（已去掉 query）' AFTER browser,
  ADD COLUMN referrer    VARCHAR(255) NULL AFTER url_path,
  ADD COLUMN lang        VARCHAR(16)  NULL AFTER referrer,
  ADD KEY idx_country_time (country, received_at);

ALTER TABLE events
  ADD COLUMN country     CHAR(2)     NULL AFTER env,
  ADD COLUMN device_type VARCHAR(16) NULL AFTER country,
  ADD COLUMN url_path    VARCHAR(255) NULL COMMENT '页面路径，便于按页面看性能' AFTER device_type,
  -- 性能指标：SDK 把指标放在 properties 里，这里物化成列，查询和索引都不必解析 JSON
  ADD COLUMN perf_stage  VARCHAR(8) GENERATED ALWAYS AS (JSON_UNQUOTE(JSON_EXTRACT(properties, '$.stage'))) VIRTUAL,
  ADD COLUMN fcp_ms      INT        GENERATED ALWAYS AS (CAST(JSON_EXTRACT(properties, '$.fcp') AS SIGNED)) VIRTUAL,
  ADD COLUMN lcp_ms      INT        GENERATED ALWAYS AS (CAST(JSON_EXTRACT(properties, '$.lcp') AS SIGNED)) VIRTUAL,
  ADD COLUMN ttfb_ms     INT        GENERATED ALWAYS AS (CAST(JSON_EXTRACT(properties, '$.ttfb') AS SIGNED)) VIRTUAL,
  ADD COLUMN load_ms     INT        GENERATED ALWAYS AS (CAST(JSON_EXTRACT(properties, '$.loadTime') AS SIGNED)) VIRTUAL,
  ADD COLUMN inp_ms      INT        GENERATED ALWAYS AS (CAST(JSON_EXTRACT(properties, '$.inp') AS SIGNED)) VIRTUAL,
  ADD COLUMN cls_score   DECIMAL(8, 4) GENERATED ALWAYS AS (CAST(JSON_EXTRACT(properties, '$.cls') AS DECIMAL(8, 4))) VIRTUAL,
  -- 停留时长
  ADD COLUMN stay_ms     INT        GENERATED ALWAYS AS (CAST(JSON_EXTRACT(properties, '$.stayTime') AS SIGNED)) VIRTUAL,
  ADD KEY idx_type_time   (app_id, env, record_type, occurred_at),
  ADD KEY idx_country     (app_id, env, country, record_type, occurred_at),
  ADD KEY idx_device      (app_id, env, device_type, record_type, occurred_at),
  ADD KEY idx_url_path    (app_id, env, url_path, occurred_at);
