import { describe, expect, it } from 'vitest';
import { normalizeCountry, normalizeIp, resolveClient } from '../../src/lib/geo.js';
import { extractPath, parseUserAgent } from '../../src/lib/ua.js';

const OPTIONS = {
  ipHeaders: ['x-real-ip', 'x-forwarded-for'],
  countryHeaders: ['cf-ipcountry', 'x-client-geo-country', 'x-client-geo-loc'],
  regionHeaders: ['x-client-geo-region', 'x-geo-region'],
};

describe('normalizeIp', () => {
  it('取 XFF 链第一个地址', () => {
    expect(normalizeIp('203.0.113.9, 10.0.0.1')).toBe('203.0.113.9');
  });

  it('去掉端口与 IPv6 方括号', () => {
    expect(normalizeIp('203.0.113.9:5678')).toBe('203.0.113.9');
    expect(normalizeIp('[2001:db8::1]:443')).toBe('2001:db8::1');
    expect(normalizeIp('2001:db8::1')).toBe('2001:db8::1');
  });

  it('非法值返回 null，不写入脏数据', () => {
    expect(normalizeIp('unknown')).toBeNull();
    expect(normalizeIp('')).toBeNull();
    expect(normalizeIp(null)).toBeNull();
  });
});

describe('normalizeCountry', () => {
  it('支持两位码与大小写', () => {
    expect(normalizeCountry('CN')).toBe('CN');
    expect(normalizeCountry('us')).toBe('US');
  });

  it('兼容阿里云 loc 头 CN,Beijing', () => {
    expect(normalizeCountry('CN,Beijing')).toBe('CN');
    expect(normalizeCountry('US;California')).toBe('US');
  });

  it('兼容 CN-Beijing 形式', () => {
    expect(normalizeCountry('CN-Beijing')).toBe('CN');
  });

  it('非法/占位值返回 null', () => {
    expect(normalizeCountry('unknown')).toBeNull();
    expect(normalizeCountry('1')).toBeNull();
    expect(normalizeCountry(undefined)).toBeNull();
  });
});

describe('resolveClient', () => {
  it('从网关头解析 IP / 国家 / 地区', () => {
    const result = resolveClient(
      { 'x-real-ip': '203.0.113.7', 'x-client-geo-country': 'sg', 'x-client-geo-region': 'Singapore' },
      '10.0.0.1',
      OPTIONS,
    );
    expect(result).toEqual({ ip: '203.0.113.7', country: 'SG', region: 'Singapore' });
  });

  it('没有网关头时回退到 request.ip', () => {
    const result = resolveClient({}, '10.0.0.1', OPTIONS);
    expect(result.ip).toBe('10.0.0.1');
    expect(result.country).toBeNull();
  });

  it('按优先级取第一个命中的国家头', () => {
    const result = resolveClient(
      { 'x-client-geo-loc': 'CN,Shanghai', 'cf-ipcountry': 'HK' },
      null,
      OPTIONS,
    );
    expect(result.country).toBe('HK');
  });
});

describe('parseUserAgent', () => {
  it('识别移动端 iOS', () => {
    const ua =
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
    const parsed = parseUserAgent(ua);
    expect(parsed.deviceType).toBe('mobile');
    expect(parsed.os).toBe('iOS');
  });

  it('桌面浏览器默认补 desktop', () => {
    const ua =
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
    const parsed = parseUserAgent(ua);
    expect(parsed.deviceType).toBe('desktop');
    expect(parsed.browser).toBe('Chrome');
  });

  it('空 UA 不报错', () => {
    expect(parseUserAgent(null)).toEqual({ deviceType: null, os: null, browser: null });
    expect(parseUserAgent('  ')).toEqual({ deviceType: null, os: null, browser: null });
  });
});

describe('extractPath', () => {
  it('去掉 query，避免敏感参数落库', () => {
    expect(extractPath('https://shop.example.com/pay/1001?token=abc&sign=xyz')).toBe('/pay/1001');
  });

  it('非法 URL 返回 null', () => {
    expect(extractPath('')).toBeNull();
    expect(extractPath(null)).toBeNull();
  });
});
