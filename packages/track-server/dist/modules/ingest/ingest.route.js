import { RejectBatchError } from '../../domain/errors.js';
import { authenticate } from './auth.js';
import { ingestBatch } from './ingest.service.js';
import { logRejected } from './rejected.logger.js';
function headerAppId(headers) {
    const value = headers['x-track-app-id'];
    if (typeof value === 'string' && value)
        return value;
    if (Array.isArray(value) && typeof value[0] === 'string')
        return value[0];
    return undefined;
}
export function registerIngestRoutes(app, deps) {
    app.post('/api/track', async (request, reply) => {
        const rawBody = typeof request.body === 'string' ? request.body : '';
        const headers = request.headers;
        const ip = request.ip;
        const ipLimit = deps.limiterIp.hit(`ip:${ip}`, deps.config.rateLimitPerIp);
        if (!ipLimit.allowed) {
            return reply
                .code(429)
                .header('retry-after', String(ipLimit.retryAfterSeconds))
                .send({ ok: false, error: 'rate_limited' });
        }
        if (!rawBody) {
            return reply.code(200).send({ ok: true, accepted: 0, rejected: 0, reason: 'empty_body' });
        }
        const auth = authenticate(deps.config, headers, rawBody, (request.query ?? {}));
        if (!auth.ok) {
            logRejected(request.log, {
                appId: headerAppId(headers),
                reason: auth.reason,
                detail: auth.detail,
                rawBody,
                ip,
            });
            return reply.code(200).send({ ok: true, accepted: 0, rejected: 0, reason: auth.reason });
        }
        const appLimit = deps.limiterApp.hit(`app:${auth.appId}`, deps.config.rateLimitPerApp);
        if (!appLimit.allowed) {
            return reply
                .code(429)
                .header('retry-after', String(appLimit.retryAfterSeconds))
                .send({ ok: false, error: 'rate_limited' });
        }
        try {
            const result = await ingestBatch({ config: deps.config, db: deps.db }, { rawBody, appId: auth.appId });
            if (result.status === 'duplicate') {
                return reply.code(200).send({
                    ok: true,
                    duplicate: true,
                    batchId: result.batchId,
                    accepted: 0,
                    rejected: 0,
                });
            }
            if (result.rejected > 0) {
                request.log.warn({ trackEvent: 'records_skipped', appId: result.appId, batchId: result.batchId, rejected: result.rejected }, 'some records were skipped');
            }
            return reply.code(200).send({
                ok: true,
                batchId: result.batchId,
                accepted: result.accepted,
                rejected: result.rejected,
            });
        }
        catch (error) {
            if (error instanceof RejectBatchError) {
                logRejected(request.log, {
                    appId: auth.appId,
                    reason: error.reason,
                    detail: error.detail,
                    rawBody,
                    ip,
                });
                return reply.code(200).send({ ok: true, accepted: 0, rejected: 0, reason: error.reason });
            }
            // DB 故障等 → 由 error-handler 转 503，让 SDK 重试
            throw error;
        }
    });
}
//# sourceMappingURL=ingest.route.js.map