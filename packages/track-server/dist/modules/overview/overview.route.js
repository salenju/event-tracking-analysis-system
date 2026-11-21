import { readInt, readString, readStringList } from '../../lib/http.js';
import { normalizeOffset, parseTimeRange, pickGranularity } from '../../lib/time.js';
import { findFunnel } from '../funnel/funnel.config.js';
import { buildOverviewSql } from '../funnel/funnel.sql.js';
function toNumber(value) {
    const num = typeof value === 'number' ? value : Number(value ?? 0);
    return Number.isFinite(num) ? num : 0;
}
export function registerOverviewRoutes(app, deps) {
    app.get('/api/overview/events', async (request) => {
        const query = (request.query ?? {});
        const funnel = findFunnel(deps.funnels, readString(query, 'key'));
        const range = parseTimeRange(readString(query, 'from'), readString(query, 'to'));
        const appId = readString(query, 'appId') ?? funnel.appId;
        const env = readString(query, 'env') ?? funnel.env ?? deps.config.trackEnv;
        const tzOffset = normalizeOffset(readString(query, 'tzOffset'), deps.config.defaultTzOffset);
        const events = readStringList(query, 'events');
        const limit = readInt(query, 'limit', { fallback: 2000, min: 1, max: 10000 });
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
        });
        const rows = await deps.db.query.query(sql, params);
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
//# sourceMappingURL=overview.route.js.map