import cors from '@fastify/cors';
import type { FastifyInstance } from 'fastify';

/**
 * text/plain 属于 CORS 简单请求，不需要预检，但响应必须带
 * Access-Control-Allow-Origin，否则前端读不到状态码、重试逻辑会整体退化。
 *
 * 看板用 Authorization: Bearer 鉴权（不用 cookie），因此 credentials 保持关闭，
 * 这样 CORS_ORIGINS=* 依然合法；代价是管理接口会多一次预检，
 * 需要在 allowedHeaders 里放行 authorization 与 PATCH/DELETE 方法。
 */
export async function registerCors(app: FastifyInstance, origins: string[]): Promise<void> {
  const allowAll = origins.length === 0 || origins.includes('*');
  await app.register(cors, {
    origin: allowAll ? true : origins,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['content-type', 'authorization', 'x-track-app-id', 'x-track-sent-at', 'x-track-sign'],
    exposedHeaders: ['retry-after'],
    // 埋点请求不带 cookie，credentials 必须关闭，否则不能用通配来源
    credentials: false,
    maxAge: 86400,
    strictPreflight: false,
  });
}
