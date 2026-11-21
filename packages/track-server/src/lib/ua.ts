import UAParser from 'ua-parser-js';

export interface ParsedUserAgent {
  deviceType: string | null;
  os: string | null;
  browser: string | null;
}

const COLUMN_LIMITS = { deviceType: 16, os: 32, browser: 32 } as const;

function clamp(value: string | undefined, max: number): string | null {
  if (!value) return null;
  const text = value.trim();
  if (!text) return null;
  return text.length > max ? text.slice(0, max) : text;
}

/**
 * UA 解析放在服务端做：
 * - 浏览器端解析会给 SDK 增加体积
 * - 解析规则更新时只需发服务端，历史 UA 可回刷
 */
export function parseUserAgent(userAgent: string | null | undefined): ParsedUserAgent {
  const ua = userAgent?.trim();
  if (!ua) return { deviceType: null, os: null, browser: null };

  const result = new UAParser(ua).getResult();
  return {
    // ua-parser 对桌面浏览器不返回 device.type，这里补成 desktop
    deviceType: clamp(result.device.type ?? 'desktop', COLUMN_LIMITS.deviceType),
    os: clamp(result.os.name, COLUMN_LIMITS.os),
    browser: clamp(result.browser.name, COLUMN_LIMITS.browser),
  };
}

/** 从完整 URL 里只取路径，避免把 query 中的敏感参数落库 */
export function extractPath(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url, 'https://placeholder.local');
    const path = `${parsed.pathname}`.trim();
    return clamp(path || '/', 255);
  } catch {
    return null;
  }
}
