import Fastify, { LogController } from 'fastify';
import { AppRegistry } from './lib/app-secret.js';
import { loggerOptions } from './lib/logger.js';
import { FixedWindowLimiter } from './lib/rate-limiter.js';
import { registerAppsRoutes } from './modules/apps/apps.route.js';
import { AppsService } from './modules/apps/apps.service.js';
import { registerAuthRoutes } from './modules/auth/auth.route.js';
import { AuthService } from './modules/auth/auth.service.js';
import { FeishuClient } from './modules/auth/feishu.client.js';
import { registerAuthGuard } from './modules/auth/guard.js';
import { findFunnel } from './modules/funnel/funnel.config.js';
import { registerExperienceRoutes } from './modules/experience/experience.route.js';
import { registerFunnelRoutes } from './modules/funnel/funnel.route.js';
import { registerIngestRoutes } from './modules/ingest/ingest.route.js';
import { registerOverviewRoutes } from './modules/overview/overview.route.js';
import { registerCors } from './plugins/cors.js';
import { registerErrorHandler } from './plugins/error-handler.js';
import { registerRawBody } from './plugins/raw-body.js';
import { MysqlAdminUserStore } from './repositories/admin-user.repo.js';
import { MysqlAppStore } from './repositories/app.repo.js';
import { MysqlLoginStateStore } from './repositories/login-state.repo.js';
import { MysqlSessionStore } from './repositories/session.repo.js';
export async function buildApp(deps) {
    const app = Fastify({
        logger: deps.logger === false ? false : loggerOptions(deps.config),
        bodyLimit: deps.config.bodyLimitBytes,
        trustProxy: true,
        // 埋点请求高频且 body 含业务数据，关闭逐请求日志，只记关键事件
        // （Fastify 6 将移除顶层 disableRequestLogging，这里使用 logController）
        logController: new LogController({ disableRequestLogging: true }),
    });
    registerRawBody(app);
    await registerCors(app, deps.config.corsOrigins);
    registerErrorHandler(app);
    const limiterIp = new FixedWindowLimiter(60_000);
    const limiterApp = new FixedWindowLimiter(60_000);
    app.addHook('onClose', async () => {
        limiterIp.stop();
        limiterApp.stop();
    });
    app.get('/healthz', async () => ({ ok: true, uptime: process.uptime() }));
    app.get('/readyz', async (_request, reply) => {
        try {
            await deps.db.ingest.query('SELECT 1');
            return { ok: true };
        }
        catch {
            return reply.code(503).send({ ok: false, error: 'db_unavailable' });
        }
    });
    const mode = deps.config.startMode;
    // 应用凭据：管理后台（analytics_apps）优先，环境变量 APP_SECRETS 兜底；
    // 纯上报模式没有管理后台，只用环境变量。
    const overrides = deps.stores ?? {};
    const appStore = mode === 'ingest' ? null : overrides.apps ?? new MysqlAppStore(deps.db.query);
    const registry = new AppRegistry(appStore, deps.config.appSecrets);
    const users = overrides.users ?? new MysqlAdminUserStore(deps.db.query);
    const sessions = overrides.sessions ?? new MysqlSessionStore(deps.db.query);
    const states = overrides.states ?? new MysqlLoginStateStore(deps.db.query);
    const feishu = overrides.feishu !== undefined
        ? overrides.feishu
        : deps.config.feishu.enabled
            ? new FeishuClient(deps.config.feishu)
            : null;
    const authService = new AuthService({
        config: deps.config,
        users,
        sessions,
        states,
        feishu,
        ...(overrides.now ? { now: overrides.now } : {}),
    });
    if (mode !== 'api') {
        registerIngestRoutes(app, { config: deps.config, db: deps.db, limiterIp, limiterApp, registry });
    }
    if (mode !== 'ingest') {
        // 登录鉴权要先于业务路由注册，保证所有 /api/* 都被覆盖
        registerAuthGuard(app, { config: deps.config, auth: authService });
        registerAuthRoutes(app, { config: deps.config, auth: authService });
        registerAppsRoutes(app, {
            config: deps.config,
            apps: new AppsService({ store: appStore, registry, users, config: deps.config }),
        });
        registerFunnelRoutes(app, { config: deps.config, db: deps.db, funnels: deps.funnels });
        registerOverviewRoutes(app, { config: deps.config, db: deps.db, funnels: deps.funnels });
        registerExperienceRoutes(app, { config: deps.config, db: deps.db, funnels: deps.funnels });
    }
    app.setNotFoundHandler((request, reply) => reply.code(404).send({ ok: false, error: 'not_found', path: request.url }));
    // 启动期校验漏斗配置可用，避免上线后看板才报错
    findFunnel(deps.funnels, undefined);
    return app;
}
//# sourceMappingURL=app.js.map