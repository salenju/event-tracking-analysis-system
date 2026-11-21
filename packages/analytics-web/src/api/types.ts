/** 与 track-server 的响应结构保持一致 */

export interface FunnelDef {
  key: string;
  name: string;
  appId: string;
  env: string;
  steps: string[];
  windowMinutes: number;
}

export interface FunnelStep {
  index: number;
  event: string;
  count: number;
  /** 相对上一步转化率，首步为 null */
  rateFromPrevious: number | null;
  /** 相对首步总转化率 */
  rateFromStart: number | null;
  /** 在上一步流失的会话数 */
  dropFromPrevious: number | null;
}

export interface FunnelResult {
  key: string;
  name: string;
  appId: string;
  env: string;
  windowMinutes: number;
  from: string;
  to: string;
  walletType: string | null;
  country: string | null;
  deviceType: string | null;
  totalSessions: number;
  steps: FunnelStep[];
}

export interface DropOffSession {
  sessionId: string;
  lastStepAt: string;
  startedAt: string;
}

export interface DropOffResult {
  key: string;
  stepIndex: number;
  stepEvent: string;
  sessions: DropOffSession[];
  hasMore: boolean;
}

export interface SessionEvent {
  event: string | null;
  recordType: string;
  walletType: string | null;
  failReason: string | null;
  orderId: string | null;
  userId: string | null;
  occurredAt: string;
  properties: unknown;
}

export interface SessionDetail {
  sessionId: string;
  appId: string;
  env: string;
  tzOffset: string;
  events: SessionEvent[];
}

export interface OverviewPoint {
  bucket: string;
  event: string;
  total: number;
  uniqueActors: number;
}

export interface OverviewResult {
  appId: string;
  env: string;
  granularity: 'hour' | 'day';
  tzOffset: string;
  from: string;
  to: string;
  points: OverviewPoint[];
}

export interface FilterQuery {
  key: string;
  appId: string;
  env: string;
  walletType: string;
  /** ISO 3166-1 alpha-2，空表示不筛选 */
  country: string;
  /** desktop / mobile / tablet，空表示不筛选 */
  deviceType: string;
  from: string;
  to: string;
}

export interface ExperienceMetric {
  key: string;
  unit: 'ms' | 'score';
  samples: number;
  avg: number | null;
  p50: number | null;
  p75: number | null;
  p95: number | null;
  max: number | null;
}

export interface ExperienceGroup {
  key: string | null;
  samples: number;
  avg: number | null;
  p75: number | null;
  max: number | null;
}

export interface PerformanceResult {
  appId: string;
  env: string;
  from: string;
  to: string;
  filters: { country: string | null; deviceType: string | null; urlPath: string | null };
  /** 有 stage=final 记录的会话数 */
  sessions: number;
  records: number;
  metrics: ExperienceMetric[];
  byPage: ExperienceGroup[];
  byCountry: ExperienceGroup[];
  byDevice: ExperienceGroup[];
}

export interface StayResult {
  appId: string;
  env: string;
  from: string;
  to: string;
  filters: { country: string | null; deviceType: string | null; urlPath: string | null };
  samples: number;
  avgMs: number | null;
  p50: number | null;
  p75: number | null;
  p95: number | null;
  maxMs: number | null;
  byPage: ExperienceGroup[];
  byTrigger: ExperienceGroup[];
}

export interface IntegrityResult {
  appId: string;
  env: string;
  from: string;
  to: string;
  batches: number;
  expectedRecords: number;
  actualRecords: number;
  missingRecords: number;
  mismatchBatches: Array<{ batchId: string; expected: number; actual: number }>;
}
