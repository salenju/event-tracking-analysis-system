<script setup lang="ts">
import { ElMessage } from 'element-plus';
import { computed, onMounted, ref } from 'vue';
import { fetchFunnels, fetchIntegrity, fetchPerformance, fetchStay } from '@/api/track';
import type {
  ExperienceGroup,
  ExperienceMetric,
  FilterQuery,
  FunnelDef,
  IntegrityResult,
  PerformanceResult,
  StayResult,
} from '@/api/types';
import FilterBar from '@/components/FilterBar.vue';
import { buildDefaultQuery, createEmptyQuery } from '@/utils/filters';
import { formatDateTime, formatNumber } from '@/utils/format';

const METRIC_META: Record<string, { label: string; hint: string }> = {
  lcp: { label: 'LCP', hint: '最大内容绘制' },
  fcp: { label: 'FCP', hint: '首次内容绘制' },
  ttfb: { label: 'TTFB', hint: '首字节时间' },
  load: { label: 'Load', hint: '页面加载完成' },
  inp: { label: 'INP', hint: '交互响应延迟' },
  cls: { label: 'CLS', hint: '累积布局偏移' },
};

const funnels = ref<FunnelDef[]>([]);
const filters = ref<FilterQuery>(createEmptyQuery());
const ready = ref(false);
const loading = ref(false);

const perf = ref<PerformanceResult | null>(null);
const stay = ref<StayResult | null>(null);
const integrity = ref<IntegrityResult | null>(null);

const metricRows = computed<ExperienceMetric[]>(() => perf.value?.metrics ?? []);

function metric(key: string): ExperienceMetric | undefined {
  return metricRows.value.find((item) => item.key === key);
}

function fmt(value: number | null | undefined, unit: 'ms' | 'score' = 'ms'): string {
  if (value === null || value === undefined) return '—';
  return unit === 'ms' ? `${formatNumber(Math.round(value))} ms` : value.toFixed(3);
}

function metricLabel(key: string): string {
  return METRIC_META[key]?.label ?? key.toUpperCase();
}

function metricHint(key: string): string {
  return METRIC_META[key]?.hint ?? '';
}

function groupKeyLabel(item: ExperienceGroup): string {
  if (item.key === null || item.key === '' ) return '（未知）';
  return item.key;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '请求失败';
}

async function load(): Promise<void> {
  loading.value = true;
  try {
    const [performance, stayResult, integrityResult] = await Promise.all([
      fetchPerformance(filters.value),
      fetchStay(filters.value),
      fetchIntegrity(filters.value),
    ]);
    perf.value = performance;
    stay.value = stayResult;
    integrity.value = integrityResult;
  } catch (error) {
    ElMessage.error(errorMessage(error));
  } finally {
    loading.value = false;
  }
}

onMounted(async () => {
  try {
    funnels.value = await fetchFunnels();
    if (!funnels.value.length) {
      ElMessage.warning('服务端未配置漏斗，请检查 packages/track-server/config/funnels.yaml');
      return;
    }
    filters.value = buildDefaultQuery(funnels.value[0]);
    ready.value = true;
    await load();
  } catch (error) {
    ElMessage.error(errorMessage(error));
  }
});

function onSearch(query: FilterQuery): void {
  filters.value = query;
  void load();
}

const integrityText = computed(() => {
  const value = integrity.value;
  if (!value) return '';
  return `${value.batches} 个批次 · 声明 ${formatNumber(value.expectedRecords)} 条 · 实际 ${formatNumber(value.actualRecords)} 条`;
});
</script>

<template>
  <section class="page-card">
    <FilterBar v-if="ready" v-model="filters" :funnels="funnels" :loading="loading" @search="onSearch" />
    <el-skeleton v-else :rows="2" animated />
  </section>

  <section v-loading="loading" class="page-card">
    <div class="card-title">
      <h3>页面加载性能</h3>
      <span class="hint">
        仅统计 sdk 的 performance 记录 · 分位数按会话内的 final 记录计算
        <template v-if="perf"> · {{ formatDateTime(perf.from) }} ~ {{ formatDateTime(perf.to) }}</template>
      </span>
    </div>

    <div class="stat-grid">
      <div class="stat-item">
        <div class="label">被观测会话数</div>
        <div class="value">{{ formatNumber(perf?.sessions ?? 0) }}<small>个</small></div>
      </div>
      <div class="stat-item">
        <div class="label">LCP P75</div>
        <div class="value">{{ fmt(metric('lcp')?.p75) }}</div>
      </div>
      <div class="stat-item">
        <div class="label">FCP P75</div>
        <div class="value">{{ fmt(metric('fcp')?.p75) }}</div>
      </div>
      <div class="stat-item">
        <div class="label">TTFB P75</div>
        <div class="value">{{ fmt(metric('ttfb')?.p75) }}</div>
      </div>
    </div>

    <el-table :data="metricRows" size="small" style="width: 100%; margin-top: 16px">
      <el-table-column label="指标" min-width="190">
        <template #default="{ row }">
          <strong>{{ metricLabel(row.key) }}</strong>
          <span class="muted" style="margin-left: 8px; font-size: 12px">{{ metricHint(row.key) }}</span>
        </template>
      </el-table-column>
      <el-table-column label="样本数" width="100" align="right">
        <template #default="{ row }">{{ formatNumber(row.samples) }}</template>
      </el-table-column>
      <el-table-column label="平均" width="120" align="right">
        <template #default="{ row }">{{ fmt(row.avg, row.unit) }}</template>
      </el-table-column>
      <el-table-column label="P50" width="120" align="right">
        <template #default="{ row }">{{ fmt(row.p50, row.unit) }}</template>
      </el-table-column>
      <el-table-column label="P75" width="120" align="right">
        <template #default="{ row }">
          <strong>{{ fmt(row.p75, row.unit) }}</strong>
        </template>
      </el-table-column>
      <el-table-column label="P95" width="120" align="right">
        <template #default="{ row }">{{ fmt(row.p95, row.unit) }}</template>
      </el-table-column>
      <el-table-column label="最大" width="120" align="right">
        <template #default="{ row }">{{ fmt(row.max, row.unit) }}</template>
      </el-table-column>

      <template #empty>
        <el-empty description="所选区间没有性能数据（SDK 需开启 autoTrack）" class="empty-block" />
      </template>
    </el-table>

    <div class="split-grid">
      <div>
        <div class="card-title" style="margin-top: 18px">
          <h3 style="font-size: 14px">按页面（LCP P75）</h3>
        </div>
        <el-table :data="perf?.byPage ?? []" size="small" style="width: 100%">
          <el-table-column label="页面路径" min-width="200">
            <template #default="{ row }">
              <span class="mono">{{ groupKeyLabel(row) }}</span>
            </template>
          </el-table-column>
          <el-table-column label="样本" width="80" align="right">
            <template #default="{ row }">{{ formatNumber(row.samples) }}</template>
          </el-table-column>
          <el-table-column label="平均" width="110" align="right">
            <template #default="{ row }">{{ fmt(row.avg) }}</template>
          </el-table-column>
          <el-table-column label="P75" width="110" align="right">
            <template #default="{ row }">{{ fmt(row.p75) }}</template>
          </el-table-column>
          <template #empty>
            <el-empty description="暂无数据" :image-size="60" />
          </template>
        </el-table>
      </div>

      <div>
        <div class="card-title" style="margin-top: 18px">
          <h3 style="font-size: 14px">按国家/地区（LCP P75）</h3>
        </div>
        <el-table :data="perf?.byCountry ?? []" size="small" style="width: 100%">
          <el-table-column label="国家" width="110">
            <template #default="{ row }"><span class="mono">{{ groupKeyLabel(row) }}</span></template>
          </el-table-column>
          <el-table-column label="样本" width="80" align="right">
            <template #default="{ row }">{{ formatNumber(row.samples) }}</template>
          </el-table-column>
          <el-table-column label="P75" width="110" align="right">
            <template #default="{ row }">{{ fmt(row.p75) }}</template>
          </el-table-column>
          <el-table-column label="最大" width="110" align="right">
            <template #default="{ row }">{{ fmt(row.max) }}</template>
          </el-table-column>
          <template #empty>
            <el-empty description="暂无数据" :image-size="60" />
          </template>
        </el-table>
      </div>
    </div>

    <div class="card-title" style="margin-top: 18px">
      <h3 style="font-size: 14px">按设备（LCP P75）</h3>
    </div>
    <el-table :data="perf?.byDevice ?? []" size="small" style="width: 100%">
      <el-table-column label="设备类型" width="140">
        <template #default="{ row }">{{ groupKeyLabel(row) }}</template>
      </el-table-column>
      <el-table-column label="样本" width="90" align="right">
        <template #default="{ row }">{{ formatNumber(row.samples) }}</template>
      </el-table-column>
      <el-table-column label="平均" width="120" align="right">
        <template #default="{ row }">{{ fmt(row.avg) }}</template>
      </el-table-column>
      <el-table-column label="P75" width="120" align="right">
        <template #default="{ row }">{{ fmt(row.p75) }}</template>
      </el-table-column>
      <template #empty>
        <el-empty description="暂无数据" :image-size="60" />
      </template>
    </el-table>
  </section>

  <section v-loading="loading" class="page-card">
    <div class="card-title">
      <h3>用户停留时长</h3>
      <span class="hint">来自 sdk 的 page_stay 记录，小于 1 秒的片段不上报</span>
    </div>

    <div class="stat-grid">
      <div class="stat-item">
        <div class="label">样本数</div>
        <div class="value">{{ formatNumber(stay?.samples ?? 0) }}<small>条</small></div>
      </div>
      <div class="stat-item">
        <div class="label">平均停留</div>
        <div class="value">{{ fmt(stay?.avgMs) }}</div>
      </div>
      <div class="stat-item">
        <div class="label">P75</div>
        <div class="value">{{ fmt(stay?.p75) }}</div>
      </div>
      <div class="stat-item">
        <div class="label">P95</div>
        <div class="value">{{ fmt(stay?.p95) }}</div>
      </div>
    </div>

    <div class="split-grid">
      <div>
        <div class="card-title" style="margin-top: 18px">
          <h3 style="font-size: 14px">按页面</h3>
        </div>
        <el-table :data="stay?.byPage ?? []" size="small" style="width: 100%">
          <el-table-column label="页面" min-width="220">
            <template #default="{ row }"><span class="mono">{{ groupKeyLabel(row) }}</span></template>
          </el-table-column>
          <el-table-column label="样本" width="80" align="right">
            <template #default="{ row }">{{ formatNumber(row.samples) }}</template>
          </el-table-column>
          <el-table-column label="平均" width="110" align="right">
            <template #default="{ row }">{{ fmt(row.avg) }}</template>
          </el-table-column>
          <el-table-column label="P75" width="110" align="right">
            <template #default="{ row }">{{ fmt(row.p75) }}</template>
          </el-table-column>
          <template #empty>
            <el-empty description="暂无数据" :image-size="60" />
          </template>
        </el-table>
      </div>

      <div>
        <div class="card-title" style="margin-top: 18px">
          <h3 style="font-size: 14px">按结束原因</h3>
        </div>
        <el-table :data="stay?.byTrigger ?? []" size="small" style="width: 100%">
          <el-table-column label="触发时机" min-width="130">
            <template #default="{ row }"><span class="mono">{{ groupKeyLabel(row) }}</span></template>
          </el-table-column>
          <el-table-column label="样本" width="80" align="right">
            <template #default="{ row }">{{ formatNumber(row.samples) }}</template>
          </el-table-column>
          <el-table-column label="平均" width="110" align="right">
            <template #default="{ row }">{{ fmt(row.avg) }}</template>
          </el-table-column>
          <template #empty>
            <el-empty description="暂无数据" :image-size="60" />
          </template>
        </el-table>
      </div>
    </div>
  </section>

  <section v-loading="loading" class="page-card">
    <div class="card-title">
      <h3>数据完整性</h3>
      <span class="hint">批次声明的记录数 vs 实际入库行数，用于发现静默丢数据</span>
    </div>

    <el-alert
      v-if="integrity && integrity.missingRecords > 0"
      type="warning"
      show-icon
      :closable="false"
      :title="`有 ${formatNumber(integrity.missingRecords)} 条记录未入库`"
      :description="`${integrityText}，请检查服务端日志中的 batch_rejected / records_skipped`"
    />
    <el-alert
      v-else-if="integrity"
      type="success"
      show-icon
      :closable="false"
      title="无缺失记录"
      :description="integrityText"
    />

    <el-table
      v-if="integrity && integrity.mismatchBatches.length"
      :data="integrity.mismatchBatches"
      size="small"
      style="width: 100%; margin-top: 12px"
    >
      <el-table-column label="批次 ID" min-width="240">
        <template #default="{ row }"><span class="mono">{{ row.batchId }}</span></template>
      </el-table-column>
      <el-table-column label="声明条数" width="110" align="right">
        <template #default="{ row }">{{ formatNumber(row.expected) }}</template>
      </el-table-column>
      <el-table-column label="实际条数" width="110" align="right">
        <template #default="{ row }">{{ formatNumber(row.actual) }}</template>
      </el-table-column>
    </el-table>
  </section>
</template>

<style scoped>
.split-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(360px, 1fr));
  gap: 20px;
}
</style>
