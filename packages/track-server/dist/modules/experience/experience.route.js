import { readString } from '../../lib/http.js';
import { parseTimeRange } from '../../lib/time.js';
import { findFunnel } from '../funnel/funnel.config.js';
import { getIntegrityReport, getPerformanceSummary, getStaySummary } from './experience.service.js';
function parseParams(request, deps) {
    const query = (request.query ?? {});
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
function rangeOf(params) {
    return { from: params.from.toISOString(), to: params.to.toISOString() };
}
export function registerExperienceRoutes(app, deps) {
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
//# sourceMappingURL=experience.route.js.map