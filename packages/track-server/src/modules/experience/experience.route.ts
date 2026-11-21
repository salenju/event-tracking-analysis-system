import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AppConfig } from '../../config/index.js';
import type { Db } from '../../lib/db.js';
import { readString, type QueryRecord } from '../../lib/http.js';
import { parseTimeRange } from '../../lib/time.js';
import { findFunnel, type FunnelDef } from '../funnel/funnel.config.js';
import { getIntegrityReport, getPerformanceSummary, getStaySummary } from './experience.service.js';
import type { ExperienceParams } from './experience.service.js';

export interface ExperienceRouteDeps {
  config: AppConfig;
  db: Db;
  funnels: FunnelDef[];
}

function parseParams(request: FastifyRequest, deps: ExperienceRouteDeps): ExperienceParams {
  const query = (request.query ?? {}) as QueryRecord;
  const funnel = findFunnel(deps.funnels, readString(query, 'key'));
  const range = parseTimeRange(readString(query, 'from'), readString(query, 'to'));
  const country = readString(query, 'country')?.toUpperCase();
  const deviceType = readString(query, 'deviceType');
  const urlPath = readString(query, 'urlPath');

  return {
    appId: readString(query, 'appId') ?? funnel.appId,
    env: readString(query, 'env') ?? funnel.env ?? deps.config.trackEnv,
    from: range.from,
    to: range.to,
    ...(country ? { country } : {}),
    ...(deviceType ? { deviceType } : {}),
    ...(urlPath ? { urlPath } : {}),
  };
}

function rangeOf(params: ExperienceParams): { from: string; to: string } {
  return { from: params.from.toISOString(), to: params.to.toISOString() };
}

export function registerExperienceRoutes(app: FastifyInstance, deps: ExperienceRouteDeps): void {
  app.get('/api/experience/performance', async (request) => {
    const params = parseParams(request, deps);
    const data = await getPerformanceSummary(deps.db.query, params);
    return {
      ok: true,
      appId: params.appId,
      env: params.env,
      ...rangeOf(params),
      filters: {
        country: params.country ?? null,
        deviceType: params.deviceType ?? null,
        urlPath: params.urlPath ?? null,
      },
      ...data,
    };
  });

  app.get('/api/experience/stay', async (request) => {
    const params = parseParams(request, deps);
    const data = await getStaySummary(deps.db.query, params);
    return {
      ok: true,
      appId: params.appId,
      env: params.env,
      ...rangeOf(params),
      filters: {
        country: params.country ?? null,
        deviceType: params.deviceType ?? null,
        urlPath: params.urlPath ?? null,
      },
      ...data,
    };
  });

  app.get('/api/meta/integrity', async (request) => {
    const params = parseParams(request, deps);
    const data = await getIntegrityReport(deps.db.query, params);
    return {
      ok: true,
      appId: params.appId,
      env: params.env,
      ...rangeOf(params),
      ...data,
    };
  });
}
