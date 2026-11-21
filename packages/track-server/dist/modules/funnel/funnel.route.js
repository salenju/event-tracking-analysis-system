import { BadRequestError } from '../../domain/errors.js';
import { readInt, readString } from '../../lib/http.js';
import { normalizeOffset, parseTimeRange } from '../../lib/time.js';
import { findSessionTimeline } from '../../repositories/event.repo.js';
import { findFunnel } from './funnel.config.js';
import { computeFunnel, listDropOffSessions } from './funnel.service.js';
export function registerFunnelRoutes(app, deps) {
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
        const query = (request.query ?? {});
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
        const query = (request.query ?? {});
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
        const params = request.params;
        const query = (request.query ?? {});
        const sessionId = params.sessionId?.trim();
        if (!sessionId)
            throw new BadRequestError('sessionId is required');
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
function safeParse(text) {
    try {
        return JSON.parse(text);
    }
    catch {
        return text;
    }
}
//# sourceMappingURL=funnel.route.js.map