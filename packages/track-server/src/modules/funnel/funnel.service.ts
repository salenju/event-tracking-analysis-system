import type { AppConfig } from '../../config/index.js';
import { BadRequestError } from '../../domain/errors.js';
import type { DbPool } from '../../lib/db.js';
import type { FunnelDef } from './funnel.config.js';
import { buildDropOffSessionsSql, buildFunnelSql } from './funnel.sql.js';

export interface FunnelParams {
  appId?: string;
  env?: string;
  from: Date;
  to: Date;
  walletType?: string;
  country?: string;
  deviceType?: string;
}

export interface FunnelStep {
  index: number;
  event: string;
  count: number;
  /** 相对上一步转化率，首步为 null */
  rateFromPrevious: number | null;
  /** 相对首步总转化率 */
  rateFromStart: number | null;
  /** 在上一步流失的会话数 */
  dropFromPrevious: number | null;
}

export interface FunnelResult {
  key: string;
  name: string;
  appId: string;
  env: string;
  windowMinutes: number;
  from: string;
  to: string;
  walletType: string | null;
  country: string | null;
  deviceType: string | null;
  totalSessions: number;
  steps: FunnelStep[];
}

function toNumber(value: unknown): number {
  const num = typeof value === 'number' ? value : Number(value ?? 0);
  return Number.isFinite(num) ? num : 0;
}

function rate(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  return Math.round((numerator / denominator) * 10000) / 10000;
}

export async function computeFunnel(
  pool: DbPool,
  funnel: FunnelDef,
  config: AppConfig,
  params: FunnelParams,
): Promise<FunnelResult> {
  const appId = params.appId ?? funnel.appId;
  const env = params.env ?? funnel.env ?? config.trackEnv;
  const query = {
    steps: funnel.steps,
    appId,
    env,
    from: params.from,
    to: params.to,
    windowMinutes: funnel.windowMinutes,
    maxExecutionMs: config.db.queryTimeoutMs,
    ...(params.walletType ? { walletType: params.walletType } : {}),
    ...(params.country ? { country: params.country } : {}),
    ...(params.deviceType ? { deviceType: params.deviceType } : {}),
  };

  const { sql, params: sqlParams } = buildFunnelSql(query);
  const rows = await pool.query<Record<string, unknown>>(sql, sqlParams);
  const row = rows[0] ?? {};

  const counts = funnel.steps.map((_, index) => toNumber(row[`step_${index}`]));
  const totalSessions = counts[0] ?? 0;

  const steps: FunnelStep[] = funnel.steps.map((event, index) => {
    const count = counts[index] ?? 0;
    const previous = index === 0 ? null : (counts[index - 1] ?? 0);
    return {
      index,
      event,
      count,
      rateFromPrevious: previous === null ? null : rate(count, previous),
      rateFromStart: index === 0 ? (count > 0 ? 1 : null) : rate(count, totalSessions),
      dropFromPrevious: previous === null ? null : Math.max(previous - count, 0),
    };
  });

  return {
    key: funnel.key,
    name: funnel.name,
    appId,
    env,
    windowMinutes: funnel.windowMinutes,
    from: params.from.toISOString(),
    to: params.to.toISOString(),
    walletType: params.walletType ?? null,
    country: params.country ?? null,
    deviceType: params.deviceType ?? null,
    totalSessions,
    steps,
  };
}

export interface DropOffSession {
  sessionId: string;
  lastStepAt: string;
  startedAt: string;
}

export interface DropOffResult {
  key: string;
  stepIndex: number;
  stepEvent: string;
  sessions: DropOffSession[];
  hasMore: boolean;
}

export async function listDropOffSessions(
  pool: DbPool,
  funnel: FunnelDef,
  config: AppConfig,
  params: FunnelParams & { stepIndex: number; limit: number; offset: number },
): Promise<DropOffResult> {
  if (params.stepIndex < 1 || params.stepIndex > funnel.steps.length - 1) {
    throw new BadRequestError(`stepIndex must be between 1 and ${funnel.steps.length - 1}`);
  }
  const appId = params.appId ?? funnel.appId;
  const env = params.env ?? funnel.env ?? config.trackEnv;

  const query = {
    steps: funnel.steps,
    appId,
    env,
    from: params.from,
    to: params.to,
    windowMinutes: funnel.windowMinutes,
    maxExecutionMs: config.db.queryTimeoutMs,
    stepIndex: params.stepIndex,
    limit: params.limit + 1,
    ...(params.walletType ? { walletType: params.walletType } : {}),
    ...(params.country ? { country: params.country } : {}),
    ...(params.deviceType ? { deviceType: params.deviceType } : {}),
  };

  const { sql, params: sqlParams } = buildDropOffSessionsSql(query);
  const rows = await pool.query<Record<string, unknown>>(sql, sqlParams);
  const hasMore = rows.length > params.limit;
  const page = hasMore ? rows.slice(0, params.limit) : rows;

  return {
    key: funnel.key,
    stepIndex: params.stepIndex,
    stepEvent: funnel.steps[params.stepIndex] ?? '',
    sessions: page.map((row) => ({
      sessionId: String(row.session_id ?? ''),
      lastStepAt: new Date(row.last_step_at as string | Date).toISOString(),
      startedAt: new Date(row.started_at as string | Date).toISOString(),
    })),
    hasMore,
  };
}
