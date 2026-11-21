import type { FilterQuery, FunnelDef } from '@/api/types';

const DAY_MS = 24 * 3600 * 1000;

/** 可选环境：对应 SDK env / 服务端 TRACK_ENV（顺序即下拉展示顺序） */
export const ENV_OPTIONS = ['dev', 'test', 'uat', 'staging', 'prod'] as const;

/** 国家/地区：ISO 3166-1 alpha-2 代码 + 中文名，服务端按代码筛选 */
export const COUNTRY_OPTIONS: Array<{ label: string; value: string }> = [
  { label: '中国大陆 CN', value: 'CN' },
  { label: '中国香港 HK', value: 'HK' },
  { label: '中国台湾 TW', value: 'TW' },
  { label: '中国澳门 MO', value: 'MO' },
  { label: '新加坡 SG', value: 'SG' },
  { label: '马来西亚 MY', value: 'MY' },
  { label: '泰国 TH', value: 'TH' },
  { label: '越南 VN', value: 'VN' },
  { label: '印度尼西亚 ID', value: 'ID' },
  { label: '菲律宾 PH', value: 'PH' },
  { label: '日本 JP', value: 'JP' },
  { label: '韩国 KR', value: 'KR' },
  { label: '印度 IN', value: 'IN' },
  { label: '巴基斯坦 PK', value: 'PK' },
  { label: '孟加拉国 BD', value: 'BD' },
  { label: '阿联酋 AE', value: 'AE' },
  { label: '沙特阿拉伯 SA', value: 'SA' },
  { label: '土耳其 TR', value: 'TR' },
  { label: '以色列 IL', value: 'IL' },
  { label: '美国 US', value: 'US' },
  { label: '加拿大 CA', value: 'CA' },
  { label: '墨西哥 MX', value: 'MX' },
  { label: '巴西 BR', value: 'BR' },
  { label: '阿根廷 AR', value: 'AR' },
  { label: '智利 CL', value: 'CL' },
  { label: '哥伦比亚 CO', value: 'CO' },
  { label: '英国 GB', value: 'GB' },
  { label: '爱尔兰 IE', value: 'IE' },
  { label: '德国 DE', value: 'DE' },
  { label: '法国 FR', value: 'FR' },
  { label: '荷兰 NL', value: 'NL' },
  { label: '比利时 BE', value: 'BE' },
  { label: '西班牙 ES', value: 'ES' },
  { label: '葡萄牙 PT', value: 'PT' },
  { label: '意大利 IT', value: 'IT' },
  { label: '瑞士 CH', value: 'CH' },
  { label: '奥地利 AT', value: 'AT' },
  { label: '瑞典 SE', value: 'SE' },
  { label: '挪威 NO', value: 'NO' },
  { label: '丹麦 DK', value: 'DK' },
  { label: '芬兰 FI', value: 'FI' },
  { label: '波兰 PL', value: 'PL' },
  { label: '捷克 CZ', value: 'CZ' },
  { label: '俄罗斯 RU', value: 'RU' },
  { label: '乌克兰 UA', value: 'UA' },
  { label: '澳大利亚 AU', value: 'AU' },
  { label: '新西兰 NZ', value: 'NZ' },
  { label: '南非 ZA', value: 'ZA' },
  { label: '尼日利亚 NG', value: 'NG' },
  { label: '埃及 EG', value: 'EG' },
];

/** 默认时间范围：含今天在内的最近 N 天，起点对齐到当天 00:00 */
export function defaultRange(days = 7): [Date, Date] {
  const to = new Date();
  const from = new Date(to.getTime() - (days - 1) * DAY_MS);
  from.setHours(0, 0, 0, 0);
  return [from, to];
}

export function rangeShortcuts(): Array<{ text: string; value: () => [Date, Date] }> {
  return [
    { text: '最近 24 小时', value: () => [new Date(Date.now() - DAY_MS), new Date()] },
    { text: '最近 7 天', value: () => defaultRange(7) },
    { text: '最近 30 天', value: () => defaultRange(30) },
    { text: '最近 90 天', value: () => defaultRange(90) },
  ];
}

/** 尚未拿到漏斗配置时的占位值 */
export function createEmptyQuery(): FilterQuery {
  const [from, to] = defaultRange(7);
  return {
    key: '',
    appId: '',
    env: 'prod',
    walletType: '',
    country: '',
    deviceType: '',
    from: from.toISOString(),
    to: to.toISOString(),
  };
}

export function buildDefaultQuery(funnel: FunnelDef): FilterQuery {
  const [from, to] = defaultRange(7);
  return {
    key: funnel.key,
    appId: funnel.appId,
    env: funnel.env,
    walletType: '',
    country: '',
    deviceType: '',
    from: from.toISOString(),
    to: to.toISOString(),
  };
}
