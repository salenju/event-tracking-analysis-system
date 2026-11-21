import Fastify, { LogController, type FastifyInstance } from 'fastify';
import type { AppConfig } from './config/index.js';
import type { Db } from './lib/db.js';
import { loggerOptions } from './lib/logger.js';
import { FixedWindowLimiter } from './lib/rate-limiter.js';
import { findFunnel, type FunnelDef } from './modules/funnel/funnel.config.js';
import { registerFunnelRoutes } from './modules/funnel/funnel.route.js';
import { registerIngestRoutes } from './modules/ingest/ingest.route.js';
import { registerOverviewRoutes } from './modules/overview/overview.route.js';
import { registerCors } from './plugins/cors.js';
import { registerErrorHandler } from './plugins/error-handler.js';
import { registerRawBody } from './plugins/raw-body.js';

export interface AppDeps {
  config: AppConfig;
  db: Db;
  funnels: FunnelDef[];
  /** 测试时传 false 关闭日志 */
  logger?: boolean;
}

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
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
    } catch {
      return reply.code(503).send({ ok: false, error: 'db_unavailable' });
    }
  });

  const mode = deps.config.startMode;
  if (mode !== 'api') {
    registerIngestRoutes(app, { config: deps.config, db: deps.db, limiterIp, limiterApp });
  }
  if (mode !== 'ingest') {
    registerFunnelRoutes(app, { config: deps.config, db: deps.db, funnels: deps.funnels });
    registerOverviewRoutes(app, { config: deps.config, db: deps.db, funnels: deps.funnels });
  }

  app.setNotFoundHandler((request, reply) =>
    reply.code(404).send({ ok: false, error: 'not_found', path: request.url }),
  );

  // 启动期校验漏斗配置可用，避免上线后看板才报错
  findFunnel(deps.funnels, undefined);

  return app;
}
