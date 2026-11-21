import { BadRequestError } from '../../domain/errors.js';
import { buildDropOffSessionsSql, buildFunnelSql } from './funnel.sql.js';
function toNumber(value) {
    const num = typeof value === 'number' ? value : Number(value ?? 0);
    return Number.isFinite(num) ? num : 0;
}
function rate(numerator, denominator) {
    if (denominator <= 0)
        return null;
    return Math.round((numerator / denominator) * 10000) / 10000;
}
export async function computeFunnel(pool, funnel, config, params) {
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
    const rows = await pool.query(sql, sqlParams);
    const row = rows[0] ?? {};
    const counts = funnel.steps.map((_, index) => toNumber(row[`step_${index}`]));
    const totalSessions = counts[0] ?? 0;
    const steps = funnel.steps.map((event, index) => {
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
export async function listDropOffSessions(pool, funnel, config, params) {
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
    const rows = await pool.query(sql, sqlParams);
    const hasMore = rows.length > params.limit;
    const page = hasMore ? rows.slice(0, params.limit) : rows;
    return {
        key: funnel.key,
        stepIndex: params.stepIndex,
        stepEvent: funnel.steps[params.stepIndex] ?? '',
        sessions: page.map((row) => ({
            sessionId: String(row.session_id ?? ''),
            lastStepAt: new Date(row.last_step_at).toISOString(),
            startedAt: new Date(row.started_at).toISOString(),
        })),
        hasMore,
    };
}
//# sourceMappingURL=funnel.service.js.map