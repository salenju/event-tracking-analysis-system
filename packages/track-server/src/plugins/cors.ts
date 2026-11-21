import cors from '@fastify/cors';
import type { FastifyInstance } from 'fastify';

/**
 * text/plain 属于 CORS 简单请求，不需要预检，但响应必须带
 * Access-Control-Allow-Origin，否则前端读不到状态码、重试逻辑会整体退化。
 */
export async function registerCors(app: FastifyInstance, origins: string[]): Promise<void> {
  const allowAll = origins.length === 0 || origins.includes('*');
  await app.register(cors, {
    origin: allowAll ? true : origins,
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['content-type', 'x-track-app-id', 'x-track-sent-at', 'x-track-sign'],
    exposedHeaders: ['retry-after'],
    // 埋点请求不带 cookie，credentials 必须关闭，否则不能用通配来源
    credentials: false,
    maxAge: 86400,
    strictPreflight: false,
  });
}
