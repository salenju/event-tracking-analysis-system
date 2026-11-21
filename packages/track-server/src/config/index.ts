import 'dotenv/config';
import { z } from 'zod';

/** 环境变量里的布尔值：只有明确写 false/0 才关闭，缺省取默认值 */
const boolFromEnv = (fallback: boolean) =>
  z.preprocess(
    (value) => {
      if (value === undefined || value === null || value === '') return fallback ? 'true' : 'false';
      return String(value);
    },
    z.enum(['true', 'false', '1', '0']).transform((value) => value === 'true' || value === '1'),
  );

const tzOffset = /^[+-]\d{2}:\d{2}$/;

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  START_MODE: z.enum(['all', 'ingest', 'api']).default('all'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().positive().max(65535).default(8080),

  DB_HOST: z.string().default('127.0.0.1'),
  DB_PORT: z.coerce.number().int().positive().default(3306),
  DB_USER: z.string().default('root'),
  DB_PASSWORD: z.string().default(''),
  DB_NAME: z.string().default('event_tracking'),
  DB_POOL_INGEST: z.coerce.number().int().positive().max(100).default(10),
  DB_POOL_QUERY: z.coerce.number().int().positive().max(100).default(5),
  DB_QUERY_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),

  APP_SECRETS: z.string().default('{}'),
  SIGN_REQUIRED: boolFromEnv(true),
  SIGN_WINDOW_SECONDS: z.coerce.number().int().positive().default(300),

  RATE_LIMIT_PER_IP: z.coerce.number().int().positive().default(600),
  RATE_LIMIT_PER_APP: z.coerce.number().int().positive().default(3000),
  CORS_ORIGINS: z.string().default('*'),

  BODY_LIMIT_BYTES: z.coerce.number().int().positive().default(262144),
  MAX_RECORDS_PER_BATCH: z.coerce.number().int().positive().default(50),
  MAX_RECORD_BYTES: z.coerce.number().int().positive().default(16384),

  TRACK_ENV: z.string().max(16).default('prod'),
  DEFAULT_TIMEZONE_OFFSET: z.string().regex(tzOffset, 'must look like +08:00').default('+08:00'),
  FUNNELS_PATH: z.string().optional(),

  /** 对外可访问的埋点服务地址（含协议），用于后台生成接入地址；留空则由前端用当前站点 origin */
  PUBLIC_TRACK_BASE_URL: z.string().default(''),
  /** SDK 静态文件地址（脚本标签接入）；留空则由前端按 <base>/sdk/track-sdk.min.js 拼接 */
  SDK_PUBLIC_URL: z.string().default(''),

  // 看板登录：飞书开放平台「网页应用」的凭证
  FEISHU_APP_ID: z.string().default(''),
  FEISHU_APP_SECRET: z.string().default(''),
  FEISHU_REDIRECT_URI: z.string().default(''),
  FEISHU_API_BASE: z.string().default('https://open.feishu.cn'),
  FEISHU_AUTH_BASE: z.string().default('https://passport.feishu.cn'),
  /** 登录成功后跳回的前端地址 */
  WEB_ORIGIN: z.string().default('http://localhost:5174'),
  /** 会话有效期（小时） */
  SESSION_TTL_HOURS: z.coerce.number().int().positive().max(24 * 30).default(168),
  /** 视为管理员的飞书 open_id，逗号分隔；库里没有任何管理员时，第一个登录用户自动成为管理员 */
  ADMIN_BOOTSTRAP_OPEN_IDS: z.string().default(''),
  /** 查询接口是否要求登录；未显式配置时：生产开启、其他环境关闭 */
  AUTH_REQUIRED: z.enum(['true', 'false', '1', '0']).optional(),
  /** 本地调试登录（不经过飞书），未显式配置时：非生产开启；生产环境始终忽略 */
  DEV_LOGIN_ENABLED: z.enum(['true', 'false', '1', '0']).optional(),

  // 客户端 IP 与地理信息由网关透传，服务端不再自己做 GeoIP 反查。
  // 按顺序取第一个命中的请求头，逗号分隔。
  CLIENT_IP_HEADERS: z
    .string()
    .default('x-real-ip,x-forwarded-for,x-client-ip'),
  GEO_COUNTRY_HEADERS: z
    .string()
    .default('cf-ipcountry,x-client-geo-country,x-geo-country,x-country-code,x-client-geo-loc,cloudfront-viewer-country'),
  GEO_REGION_HEADERS: z
    .string()
    .default('x-client-geo-region,x-geo-region,x-region'),

  LOG_LEVEL: z.string().default('info'),
});

export interface DbConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  poolIngest: number;
  poolQuery: number;
  queryTimeoutMs: number;
}

export interface AppConfig {
  nodeEnv: 'development' | 'test' | 'production';
  startMode: 'all' | 'ingest' | 'api';
  host: string;
  port: number;
  db: DbConfig;
  /** appId → secret，同时充当接入白名单 */
  appSecrets: Record<string, string>;
  signRequired: boolean;
  signWindowSeconds: number;
  rateLimitPerIp: number;
  rateLimitPerApp: number;
  corsOrigins: string[];
  bodyLimitBytes: number;
  maxRecordsPerBatch: number;
  maxRecordBytes: number;
  trackEnv: string;
  defaultTzOffset: string;
  /** 对外埋点服务地址，空字符串表示由前端用当前站点 origin */
  trackPublicBaseUrl: string;
  /** SDK 静态文件地址，空字符串表示由前端按默认路径拼接 */
  sdkPublicUrl: string;
  funnelsPath?: string;
  logLevel: string;
  clientIpHeaders: string[];
  geoCountryHeaders: string[];
  geoRegionHeaders: string[];
  /** 查询接口是否要求登录 */
  authRequired: boolean;
  /** 本地调试登录是否可用（生产环境恒为 false） */
  devLoginEnabled: boolean;
  sessionTtlHours: number;
  /** 登录成功后跳回的前端地址 */
  webOrigin: string;
  /** 飞书网页应用登录配置 */
  feishu: {
    appId: string;
    appSecret: string;
    redirectUri: string;
    apiBase: string;
    authBase: string;
    /** 未配置 appId/secret 时登录不可用 */
    enabled: boolean;
  };
  /** 直接授予管理员权限的飞书 open_id */
  bootstrapAdminOpenIds: string[];
}

function splitList(raw: string): string[] {
  return raw
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function splitRawList(raw: string): string[] {
  return raw
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseSecrets(raw: string): Record<string, string> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('APP_SECRETS must be valid JSON, e.g. {"my-app":"secret"}');
  }
  const result = z.record(z.string()).safeParse(parsed);
  if (!result.success) {
    throw new Error('APP_SECRETS must be a flat object of appId → secret string');
  }
  return result.data;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const detail = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
    throw new Error(`Invalid environment configuration -> ${detail}`);
  }
  const data = parsed.data;
  const appSecrets = parseSecrets(data.APP_SECRETS);
  if (Object.keys(appSecrets).length === 0 && data.START_MODE === 'ingest') {
    // 纯上报模式没有管理后台，应用只能来自环境变量，空配置必然是部署错误
    throw new Error('APP_SECRETS is empty: ingest-only mode requires at least one appId');
  }

  const readBool = (raw: 'true' | 'false' | '1' | '0' | undefined, fallback: boolean): boolean => {
    if (raw === undefined) return fallback;
    return raw === 'true' || raw === '1';
  };
  const isProduction = data.NODE_ENV === 'production';
  const webOrigin = data.WEB_ORIGIN.replace(/\/+$/, '');
  const feishuEnabled = Boolean(data.FEISHU_APP_ID && data.FEISHU_APP_SECRET);

  const cfg: AppConfig = {
    nodeEnv: data.NODE_ENV,
    startMode: data.START_MODE,
    host: data.HOST,
    port: data.PORT,
    db: {
      host: data.DB_HOST,
      port: data.DB_PORT,
      user: data.DB_USER,
      password: data.DB_PASSWORD,
      database: data.DB_NAME,
      poolIngest: data.DB_POOL_INGEST,
      poolQuery: data.DB_POOL_QUERY,
      queryTimeoutMs: data.DB_QUERY_TIMEOUT_MS,
    },
    appSecrets,
    signRequired: data.SIGN_REQUIRED,
    signWindowSeconds: data.SIGN_WINDOW_SECONDS,
    rateLimitPerIp: data.RATE_LIMIT_PER_IP,
    rateLimitPerApp: data.RATE_LIMIT_PER_APP,
    corsOrigins: data.CORS_ORIGINS.split(',')
      .map((item) => item.trim())
      .filter(Boolean),
    bodyLimitBytes: data.BODY_LIMIT_BYTES,
    maxRecordsPerBatch: data.MAX_RECORDS_PER_BATCH,
    maxRecordBytes: data.MAX_RECORD_BYTES,
    trackEnv: data.TRACK_ENV,
    defaultTzOffset: data.DEFAULT_TIMEZONE_OFFSET,
    trackPublicBaseUrl: data.PUBLIC_TRACK_BASE_URL.replace(/\/+$/, ''),
    sdkPublicUrl: data.SDK_PUBLIC_URL.trim(),
    logLevel: data.LOG_LEVEL,
    clientIpHeaders: splitList(data.CLIENT_IP_HEADERS),
    geoCountryHeaders: splitList(data.GEO_COUNTRY_HEADERS),
    geoRegionHeaders: splitList(data.GEO_REGION_HEADERS),
    // 生产必须登录，其他环境默认放开，避免本地起服务还要配飞书应用
    authRequired: readBool(data.AUTH_REQUIRED, isProduction),
    devLoginEnabled: !isProduction && readBool(data.DEV_LOGIN_ENABLED, true),
    sessionTtlHours: data.SESSION_TTL_HOURS,
    webOrigin,
    feishu: {
      appId: data.FEISHU_APP_ID,
      appSecret: data.FEISHU_APP_SECRET,
      // 默认走 /api/auth/feishu/callback；dev 由 vite 代理到后端，生产请配成后端域名
      redirectUri: data.FEISHU_REDIRECT_URI || `${webOrigin}/api/auth/feishu/callback`,
      apiBase: data.FEISHU_API_BASE.replace(/\/+$/, ''),
      authBase: data.FEISHU_AUTH_BASE.replace(/\/+$/, ''),
      enabled: feishuEnabled,
    },
    bootstrapAdminOpenIds: splitRawList(data.ADMIN_BOOTSTRAP_OPEN_IDS),
  };
  if (data.FUNNELS_PATH) cfg.funnelsPath = data.FUNNELS_PATH;
  return cfg;
}
