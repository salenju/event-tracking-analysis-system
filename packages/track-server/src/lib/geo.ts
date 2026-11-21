import { isIP } from 'node:net';

export interface ClientGeo {
  ip: string | null;
  country: string | null;
  region: string | null;
}

function readHeader(headers: Record<string, unknown>, name: string): string | undefined {
  const value = headers[name];
  if (typeof value === 'string' && value) return value;
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
  return undefined;
}

/**
 * 去掉端口、取 XFF 链里的第一个地址。
 * 注意：不能无脑按 `:\d+$` 截断，IPv6 本身就带冒号（如 `2001:db8::1`）。
 */
export function normalizeIp(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const first = raw.split(',')[0]?.trim();
  if (!first) return null;

  if (isIP(first)) return first;

  const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(first);
  if (bracketed?.[1] && isIP(bracketed[1])) return bracketed[1];

  const ipv4WithPort = /^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/.exec(first);
  if (ipv4WithPort?.[1] && isIP(ipv4WithPort[1])) return ipv4WithPort[1];

  return null;
}

/**
 * 国家码归一化，兼容网关常见的几种形态：
 * - `CN`
 * - `CN,Beijing`（阿里云 CDN 的 loc 头）
 * - `CN-Beijing`
 * - `cn`
 * 取不到合法两位字母码时返回 null，绝不写入脏值。
 */
export function normalizeCountry(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const head = raw.split(/[,;|]/)[0]?.trim() ?? '';
  const matched = /^([A-Za-z]{2})(?:[-_]|$)/.exec(head);
  if (!matched) return null;
  const code = matched[1].toUpperCase();
  // 排除 "unknown" 之类的占位值（被切成 "UN" 的情况）
  if (code === 'UN' && head.length > 2) return null;
  return code;
}

function firstHeaderValue(
  headers: Record<string, unknown>,
  names: readonly string[],
): string | undefined {
  for (const name of names) {
    const value = readHeader(headers, name);
    if (value) return value;
  }
  return undefined;
}

/**
 * 解析客户端地理信息。
 * 有网关时国家/地区由网关写入请求头，服务端不自己做 GeoIP 反查。
 */
export function resolveClient(
  headers: Record<string, unknown>,
  fallbackIp: string | null,
  options: { ipHeaders: readonly string[]; countryHeaders: readonly string[]; regionHeaders: readonly string[] },
): ClientGeo {
  const rawIp = firstHeaderValue(headers, options.ipHeaders);
  const ip = normalizeIp(rawIp) ?? normalizeIp(fallbackIp);
  const country = normalizeCountry(firstHeaderValue(headers, options.countryHeaders));
  const regionRaw = firstHeaderValue(headers, options.regionHeaders);
  return {
    ip,
    country,
    region: regionRaw ? regionRaw.split(/[,;|]/)[0]!.trim().slice(0, 64) || null : null,
  };
}
