import { describe, expect, it } from 'vitest';
import { isWithinWindow, signPayload, verifyPayload } from '../../src/lib/signature.js';

describe('signature', () => {
  const secret = 'test-secret';
  const appId = 'test-app';
  const sentAt = 1_700_000_000_000;
  const body = '{"appId":"test-app","batch":[]}';

  it('生成稳定的 HMAC-SHA256 hex', () => {
    const signature = signPayload(appId, sentAt, body, secret);
    expect(signature).toMatch(/^[0-9a-f]{64}$/);
    expect(signature).toBe(signPayload(appId, String(sentAt), body, secret));
  });

  it('校验通过', () => {
    const signature = signPayload(appId, sentAt, body, secret);
    expect(verifyPayload(appId, sentAt, body, secret, signature)).toBe(true);
    expect(verifyPayload(appId, sentAt, body, secret, signature.toUpperCase())).toBe(true);
  });

  it('body 被篡改则校验失败', () => {
    const signature = signPayload(appId, sentAt, body, secret);
    expect(verifyPayload(appId, sentAt, `${body} `, secret, signature)).toBe(false);
  });

  it('长度不一致不抛异常', () => {
    expect(verifyPayload(appId, sentAt, body, secret, 'abc')).toBe(false);
  });

  it('时间窗：超出窗口判为过期', () => {
    const now = 1_700_000_600_000;
    expect(isWithinWindow(now - 60_000, 300, now)).toBe(true);
    expect(isWithinWindow(now - 600_000, 300, now)).toBe(false);
    expect(isWithinWindow(Number.NaN, 300, now)).toBe(false);
  });
});
