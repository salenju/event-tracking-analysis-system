import type { FastifyError, FastifyInstance } from 'fastify';
import { BadRequestError } from '../domain/errors.js';

export function isTrackPath(url: string): boolean {
  return url.startsWith('/api/track');
}

const TRACK_ONLY_CODES = new Set(['FST_ERR_CTP_BODY_TOO_LARGE', 'FST_ERR_CTP_INVALID_MEDIA_TYPE']);

/**
 * 返回码契约（架构文档 5.2）：
 * - 埋点接口的"不可重试失败"一律 200（否则 SDK 会无限重试）
 * - DB 故障返回 503，让 SDK 重试
 */
export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error: FastifyError, request, reply) => {
    const track = isTrackPath(request.url);

    if (TRACK_ONLY_CODES.has(error.code ?? '')) {
      if (track) {
        request.log.warn({ trackEvent: 'batch_rejected', reason: error.code }, 'track batch rejected');
        return reply.code(200).send({
          ok: true,
          accepted: 0,
          rejected: 0,
          reason: error.code === 'FST_ERR_CTP_BODY_TOO_LARGE' ? 'body_too_large' : 'unsupported_media_type',
        });
      }
      return reply.code(error.statusCode ?? 413).send({ ok: false, error: error.code });
    }

    if (error instanceof BadRequestError) {
      return reply.code(400).send({ ok: false, error: 'bad_request', message: error.message });
    }

    if (error.statusCode && error.statusCode < 500) {
      return reply.code(error.statusCode).send({ ok: false, error: error.code ?? 'client_error', message: error.message });
    }

    request.log.error({ err: error }, 'request failed');
    if (track) {
      return reply.code(503).send({ ok: false, error: 'unavailable' });
    }
    return reply.code(500).send({ ok: false, error: 'internal_error' });
  });
}
