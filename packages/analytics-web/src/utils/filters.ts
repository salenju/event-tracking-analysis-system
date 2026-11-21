import type { FilterQuery, FunnelDef } from '@/api/types';

const DAY_MS = 24 * 3600 * 1000;

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
