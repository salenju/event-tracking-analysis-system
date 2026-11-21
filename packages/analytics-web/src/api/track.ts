import { request } from './client';
import type {
  DropOffResult,
  FilterQuery,
  FunnelDef,
  FunnelResult,
  IntegrityResult,
  OverviewResult,
  PerformanceResult,
  SessionDetail,
  StayResult,
} from './types';

export async function fetchFunnels(): Promise<FunnelDef[]> {
  const data = await request<{ funnels: FunnelDef[] }>('/api/meta/funnels');
  return data.funnels ?? [];
}

export async function fetchFunnel(query: FilterQuery): Promise<FunnelResult> {
  return request<FunnelResult>('/api/funnel', { ...query });
}

export async function fetchDropOffSessions(
  query: FilterQuery,
  stepIndex: number,
  options: { limit?: number; offset?: number } = {},
): Promise<DropOffResult> {
  return request<DropOffResult>('/api/funnel/sessions', {
    ...query,
    stepIndex,
    limit: options.limit ?? 20,
    offset: options.offset ?? 0,
  });
}

export async function fetchSessionDetail(
  sessionId: string,
  query: Pick<FilterQuery, 'key' | 'appId' | 'env'>,
): Promise<SessionDetail> {
  return request<SessionDetail>(`/api/funnel/session/${encodeURIComponent(sessionId)}`, { ...query });
}

export async function fetchOverview(query: FilterQuery): Promise<OverviewResult> {
  return request<OverviewResult>('/api/overview/events', { ...query });
}

/** 性能指标不关心钱包类型，去掉避免后端按无用维度过滤 */
function experienceParams(query: FilterQuery): Record<string, string> {
  return {
    key: query.key,
    appId: query.appId,
    env: query.env,
    country: query.country,
    deviceType: query.deviceType,
    from: query.from,
    to: query.to,
  };
}

export async function fetchPerformance(query: FilterQuery): Promise<PerformanceResult> {
  return request<PerformanceResult>('/api/experience/performance', experienceParams(query));
}

export async function fetchStay(query: FilterQuery): Promise<StayResult> {
  return request<StayResult>('/api/experience/stay', experienceParams(query));
}

export async function fetchIntegrity(query: FilterQuery): Promise<IntegrityResult> {
  return request<IntegrityResult>('/api/meta/integrity', experienceParams(query));
}
