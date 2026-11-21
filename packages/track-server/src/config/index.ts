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
  funnelsPath?: string;
  logLevel: string;
  clientIpHeaders: string[];
  geoCountryHeaders: string[];
  geoRegionHeaders: string[];
}

function splitList(raw: string): string[] {
  return raw
    .split(',')
    .map((item) => item.trim().toLowerCase())
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
  if (Object.keys(appSecrets).length === 0 && data.START_MODE !== 'api') {
    // 没有配置任何 app 时，所有上报都会被拒绝，属于必然的部署错误，直接失败更安全
    throw new Error('APP_SECRETS is empty: at least one appId must be configured');
  }

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
    logLevel: data.LOG_LEVEL,
    clientIpHeaders: splitList(data.CLIENT_IP_HEADERS),
    geoCountryHeaders: splitList(data.GEO_COUNTRY_HEADERS),
    geoRegionHeaders: splitList(data.GEO_REGION_HEADERS),
  };
  if (data.FUNNELS_PATH) cfg.funnelsPath = data.FUNNELS_PATH;
  return cfg;
}
