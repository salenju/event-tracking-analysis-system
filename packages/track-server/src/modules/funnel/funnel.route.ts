import type { FastifyInstance } from 'fastify';
import type { AppConfig } from '../../config/index.js';
import { BadRequestError } from '../../domain/errors.js';
import type { Db } from '../../lib/db.js';
import { readInt, readString, type QueryRecord } from '../../lib/http.js';
import { normalizeOffset, parseTimeRange } from '../../lib/time.js';
import { findSessionTimeline } from '../../repositories/event.repo.js';
import { findFunnel, type FunnelDef } from './funnel.config.js';
import { computeFunnel, listDropOffSessions } from './funnel.service.js';

export interface FunnelRouteDeps {
  config: AppConfig;
  db: Db;
  funnels: FunnelDef[];
}

export function registerFunnelRoutes(app: FastifyInstance, deps: FunnelRouteDeps): void {
  app.get('/api/meta/funnels', async () => ({
    ok: true,
    funnels: deps.funnels.map((funnel) => ({
      key: funnel.key,
      name: funnel.name,
      appId: funnel.appId,
      env: funnel.env ?? deps.config.trackEnv,
      steps: funnel.steps,
      windowMinutes: funnel.windowMinutes,
    })),
  }));

  app.get('/api/funnel', async (request) => {
    const query = (request.query ?? {}) as QueryRecord;
    const funnel = findFunnel(deps.funnels, readString(query, 'key'));
    const range = parseTimeRange(readString(query, 'from'), readString(query, 'to'));
    const walletType = readString(query, 'walletType');
    const appId = readString(query, 'appId');
    const env = readString(query, 'env');

    const result = await computeFunnel(deps.db.query, funnel, deps.config, {
      from: range.from,
      to: range.to,
      ...(walletType ? { walletType } : {}),
      ...(appId ? { appId } : {}),
      ...(env ? { env } : {}),
    });
    return { ok: true, ...result };
  });

  app.get('/api/funnel/sessions', async (request) => {
    const query = (request.query ?? {}) as QueryRecord;
    const funnel = findFunnel(deps.funnels, readString(query, 'key'));
    const range = parseTimeRange(readString(query, 'from'), readString(query, 'to'));
    const stepIndex = readInt(query, 'stepIndex', { fallback: 1, min: 1, max: funnel.steps.length - 1 });
    const limit = readInt(query, 'limit', { fallback: 20, min: 1, max: 200 });
    const offset = readInt(query, 'offset', { fallback: 0, min: 0, max: 100000 });
    const walletType = readString(query, 'walletType');
    const appId = readString(query, 'appId');
    const env = readString(query, 'env');

    const result = await listDropOffSessions(deps.db.query, funnel, deps.config, {
      from: range.from,
      to: range.to,
      stepIndex,
      limit,
      offset,
      ...(walletType ? { walletType } : {}),
      ...(appId ? { appId } : {}),
      ...(env ? { env } : {}),
    });
    return { ok: true, ...result };
  });

  app.get('/api/funnel/session/:sessionId', async (request) => {
    const params = request.params as { sessionId?: string };
    const query = (request.query ?? {}) as QueryRecord;
    const sessionId = params.sessionId?.trim();
    if (!sessionId) throw new BadRequestError('sessionId is required');

    const funnel = findFunnel(deps.funnels, readString(query, 'key'));
    const appId = readString(query, 'appId') ?? funnel.appId;
    const env = readString(query, 'env') ?? funnel.env ?? deps.config.trackEnv;
    const limit = readInt(query, 'limit', { fallback: 200, min: 1, max: 1000 });
    const tzOffset = normalizeOffset(readString(query, 'tzOffset'), deps.config.defaultTzOffset);

    const timeline = await findSessionTimeline(deps.db.query, { sessionId, appId, env, limit });
    return {
      ok: true,
      sessionId,
      appId,
      env,
      tzOffset,
      events: timeline.map((item) => ({
        event: item.event,
        recordType: item.recordType,
        walletType: item.walletType,
        failReason: item.failReason,
        orderId: item.orderId,
        userId: item.userId,
        occurredAt: new Date(item.occurredAt).toISOString(),
        properties: item.properties ? safeParse(item.properties) : null,
      })),
    };
  });
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
