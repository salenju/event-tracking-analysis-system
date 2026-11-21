import { request } from './client';
import type {
  DropOffResult,
  FilterQuery,
  FunnelDef,
  FunnelResult,
  OverviewResult,
  SessionDetail,
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
