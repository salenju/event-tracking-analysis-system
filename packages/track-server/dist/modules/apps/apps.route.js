import { z } from 'zod';
import { BadRequestError } from '../../domain/errors.js';
import { readJsonBody } from '../../lib/http.js';
import { requireAdmin } from '../auth/guard.js';
const CreateAppBody = z.object({
    name: z.string().min(1).max(64),
    env: z.string().max(16).optional(),
    remark: z.string().max(255).nullable().optional(),
});
const UpdateAppBody = z.object({
    name: z.string().min(1).max(64).optional(),
    env: z.string().max(16).optional(),
    status: z.enum(['active', 'disabled']).optional(),
    remark: z.string().max(255).nullable().optional(),
});
const UpdateUserBody = z.object({
    role: z.enum(['admin', 'viewer']).optional(),
    status: z.enum(['active', 'disabled']).optional(),
});
function parseBody(schema, body) {
    const parsed = schema.safeParse(body ?? {});
    if (!parsed.success) {
        const detail = parsed.error.issues.map((issue) => `${issue.path.join('.') || 'body'}: ${issue.message}`).join('; ');
        throw new BadRequestError(detail);
    }
    return parsed.data;
}
function appIdParam(request) {
    const appId = request.params.appId?.trim();
    if (!appId)
        throw new BadRequestError('appId is required');
    return appId;
}
export function registerAppsRoutes(app, deps) {
    /** 列表：密钥只返回掩码，明文只在创建/轮换时出现一次 */
    app.get('/api/admin/apps', async () => ({
        ok: true,
        apps: await deps.apps.list(),
        signing: {
            signRequired: deps.config.signRequired,
            signWindowSeconds: deps.config.signWindowSeconds,
            trackPath: '/api/track',
            env: deps.config.trackEnv,
            /** 空字符串表示前端用当前站点 origin 拼完整地址 */
            publicBaseUrl: deps.config.trackPublicBaseUrl,
            /** 空字符串表示前端按 <base>/sdk/track-sdk.min.js 拼 */
            sdkUrl: deps.config.sdkPublicUrl,
        },
    }));
    app.post('/api/admin/apps', async (request) => {
        const actor = requireAdmin(request);
        const body = parseBody(CreateAppBody, readJsonBody(request.body));
        const result = await deps.apps.create(body, actor);
        return { ok: true, ...result };
    });
    app.patch('/api/admin/apps/:appId', async (request) => {
        requireAdmin(request);
        const body = parseBody(UpdateAppBody, readJsonBody(request.body));
        const app = await deps.apps.update(appIdParam(request), body);
        return { ok: true, app };
    });
    /** 轮换密钥：旧密钥立即失效，SDK 必须同步更新 */
    app.post('/api/admin/apps/:appId/rotate', async (request) => {
        requireAdmin(request);
        const result = await deps.apps.rotate(appIdParam(request));
        return { ok: true, ...result };
    });
    app.delete('/api/admin/apps/:appId', async (request) => {
        requireAdmin(request);
        await deps.apps.remove(appIdParam(request));
        return { ok: true };
    });
    app.get('/api/admin/users', async () => ({
        ok: true,
        users: await deps.apps.listUsers(),
    }));
    app.patch('/api/admin/users/:id', async (request) => {
        const actor = requireAdmin(request);
        const raw = request.params.id;
        const id = Number(raw);
        if (!Number.isInteger(id) || id <= 0)
            throw new BadRequestError('id must be a positive integer');
        const body = parseBody(UpdateUserBody, readJsonBody(request.body));
        const user = await deps.apps.updateUser(id, body, actor);
        return { ok: true, user };
    });
}
//# sourceMappingURL=apps.route.js.map