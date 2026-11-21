import type { FastifyInstance } from 'fastify';

/**
 * SDK 用 text/plain 发送 JSON 字符串（规避 CORS 预检 + 保住 sendBeacon）。
 * 这里统一按原始字符串接收，业务层自己 JSON.parse。
 * 注意：不能用 Content-Type 判断内容是否为 JSON。
 */
export function registerRawBody(app: FastifyInstance): void {
  app.addContentTypeParser(
    ['text/plain', 'application/json', 'application/x-www-form-urlencoded', 'application/octet-stream'],
    { parseAs: 'string' },
    (_request, body, done) => {
      done(null, body);
    },
  );
}
