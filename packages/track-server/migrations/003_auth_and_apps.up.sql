-- 003：看板登录（飞书 OAuth）与应用注册中心
-- 1) analytics_apps：管理员在后台颁发/停用/轮换的应用凭据，埋点验签优先读它，
--    环境变量 APP_SECRETS 仍作为兜底（存量静态应用在页面上标记为 env，不可轮换）
-- 2) admin_users / admin_sessions：飞书扫码或授权登录后的看板身份与会话
-- 3) auth_login_states：OAuth state 一次性校验，防 CSRF 与重放

CREATE TABLE IF NOT EXISTS analytics_apps (
  app_id     VARCHAR(64)  NOT NULL COMMENT '埋点 appId，SDK 侧配置值',
  name       VARCHAR(128) NOT NULL COMMENT '应用名称',
  secret     VARCHAR(128) NOT NULL COMMENT 'HMAC 签名密钥；列表接口只返回掩码',
  env        VARCHAR(16)  NOT NULL DEFAULT 'prod' COMMENT '默认上报环境，仅作提示',
  status     VARCHAR(16)  NOT NULL DEFAULT 'active' COMMENT 'active / disabled',
  remark     VARCHAR(255) NULL,
  created_by VARCHAR(128) NULL COMMENT '创建人（飞书 open_id 或名称）',
  created_at DATETIME(3)  NOT NULL,
  updated_at DATETIME(3)  NOT NULL,
  PRIMARY KEY (app_id),
  KEY idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='埋点应用注册表';

CREATE TABLE IF NOT EXISTS admin_users (
  id             BIGINT AUTO_INCREMENT PRIMARY KEY,
  feishu_open_id VARCHAR(64)  NULL COMMENT '飞书 open_id，扫码/授权登录的稳定标识',
  feishu_union_id VARCHAR(64) NULL,
  feishu_user_id VARCHAR(64)  NULL,
  name           VARCHAR(128) NOT NULL,
  avatar_url     VARCHAR(512) NULL,
  email          VARCHAR(255) NULL,
  role           VARCHAR(16)  NOT NULL DEFAULT 'viewer' COMMENT 'admin / viewer',
  status         VARCHAR(16)  NOT NULL DEFAULT 'active' COMMENT 'active / disabled',
  source         VARCHAR(16)  NOT NULL DEFAULT 'feishu' COMMENT 'feishu / local（仅本地调试登录）',
  local_username VARCHAR(64)  NULL COMMENT '本地调试账号名',
  created_at     DATETIME(3)  NOT NULL,
  updated_at     DATETIME(3)  NOT NULL,
  last_login_at  DATETIME(3)  NULL,
  UNIQUE KEY uk_feishu_open_id (feishu_open_id),
  UNIQUE KEY uk_local_username (local_username),
  KEY idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='看板用户';

CREATE TABLE IF NOT EXISTS admin_sessions (
  token_hash  CHAR(64)     NOT NULL COMMENT 'token 的 sha256，库里不存明文 token',
  user_id     BIGINT       NOT NULL,
  expires_at  DATETIME(3)  NOT NULL,
  created_at  DATETIME(3)  NOT NULL,
  ip          VARCHAR(45)  NULL,
  user_agent  VARCHAR(512) NULL,
  PRIMARY KEY (token_hash),
  KEY idx_user (user_id),
  KEY idx_expires (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='看板登录会话';

CREATE TABLE IF NOT EXISTS auth_login_states (
  state      CHAR(32)     NOT NULL COMMENT 'OAuth state，一次性使用',
  mode       VARCHAR(16)  NOT NULL DEFAULT 'qr' COMMENT 'qr / redirect',
  expires_at DATETIME(3)  NOT NULL,
  created_at DATETIME(3)  NOT NULL,
  PRIMARY KEY (state),
  KEY idx_expires (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='飞书登录 state';
