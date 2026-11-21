import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * 签名原文：`${appId}.${sentAt}.${rawBody}`
 * SDK 侧（packages/sdk-web）用同一算法计算 X-Track-Sign，改这里必须同步改 SDK。
 */
export function signPayload(appId: string, sentAt: number | string, rawBody: string, secret: string): string {
  return createHmac('sha256', secret).update(`${appId}.${sentAt}.${rawBody}`, 'utf8').digest('hex');
}

export function verifyPayload(
  appId: string,
  sentAt: number | string,
  rawBody: string,
  secret: string,
  provided: string,
): boolean {
  const expected = signPayload(appId, sentAt, rawBody, secret);
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(String(provided).toLowerCase(), 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** sentAt 允许的时间偏移（毫秒） */
export function isWithinWindow(sentAt: number, windowSeconds: number, now = Date.now()): boolean {
  if (!Number.isFinite(sentAt)) return false;
  return Math.abs(now - sentAt) <= windowSeconds * 1000;
}
