import type { FastifyInstance } from 'fastify';
import type { AppConfig } from '../../config/index.js';
import type { Db } from '../../lib/db.js';
import { readInt, readString, readStringList, type QueryRecord } from '../../lib/http.js';
import { normalizeOffset, parseTimeRange, pickGranularity } from '../../lib/time.js';
import { findFunnel, type FunnelDef } from '../funnel/funnel.config.js';
import { buildOverviewSql } from '../funnel/funnel.sql.js';

export interface OverviewRouteDeps {
  config: AppConfig;
  db: Db;
  funnels: FunnelDef[];
}

function toNumber(value: unknown): number {
  const num = typeof value === 'number' ? value : Number(value ?? 0);
  return Number.isFinite(num) ? num : 0;
}

export function registerOverviewRoutes(app: FastifyInstance, deps: OverviewRouteDeps): void {
  app.get('/api/overview/events', async (request) => {
    const query = (request.query ?? {}) as QueryRecord;
    const funnel = findFunnel(deps.funnels, readString(query, 'key'));
    const range = parseTimeRange(readString(query, 'from'), readString(query, 'to'));
    const appId = readString(query, 'appId') ?? funnel.appId;
    const env = readString(query, 'env') ?? funnel.env ?? deps.config.trackEnv;
    const tzOffset = normalizeOffset(readString(query, 'tzOffset'), deps.config.defaultTzOffset);
    const events = readStringList(query, 'events');
    const limit = readInt(query, 'limit', { fallback: 2000, min: 1, max: 10000 });
    const country = readString(query, 'country')?.toUpperCase();
    const deviceType = readString(query, 'deviceType');

    const granularity = pickGranularity(range);
    const { sql, params } = buildOverviewSql({
      appId,
      env,
      from: range.from,
      to: range.to,
      tzOffset,
      granularity,
      limit,
      ...(events ? { events } : {}),
      ...(country ? { country } : {}),
      ...(deviceType ? { deviceType } : {}),
    });

    const rows = await deps.db.query.query<Record<string, unknown>>(sql, params);
    return {
      ok: true,
      appId,
      env,
      granularity,
      tzOffset,
      from: range.from.toISOString(),
      to: range.to.toISOString(),
      points: rows.map((row) => ({
        bucket: String(row.bucket ?? ''),
        event: String(row.event ?? ''),
        total: toNumber(row.total),
        uniqueActors: toNumber(row.unique_actors),
      })),
    };
  });
}
