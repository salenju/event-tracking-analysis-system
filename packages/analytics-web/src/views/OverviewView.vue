<script setup lang="ts">
import { ElMessage } from 'element-plus';
import { computed, onMounted, ref } from 'vue';
import { fetchFunnels, fetchOverview } from '@/api/track';
import type { FilterQuery, FunnelDef, OverviewResult } from '@/api/types';
import FilterBar from '@/components/FilterBar.vue';
import TrendChart from '@/components/TrendChart.vue';
import { buildDefaultQuery, createEmptyQuery } from '@/utils/filters';
import { eventLabel, formatDateTime, formatNumber, formatPercent } from '@/utils/format';

const funnels = ref<FunnelDef[]>([]);
const filters = ref<FilterQuery>(createEmptyQuery());
const ready = ref(false);
const loading = ref(false);
const result = ref<OverviewResult | null>(null);
const metric = ref<'total' | 'uniqueActors'>('total');

const points = computed(() => result.value?.points ?? []);

const totals = computed(() => {
  const map = new Map<string, { event: string; total: number; uniqueActors: number }>();
  for (const point of points.value) {
    const current = map.get(point.event) ?? { event: point.event, total: 0, uniqueActors: 0 };
    current.total += point.total;
    current.uniqueActors += point.uniqueActors;
    map.set(point.event, current);
  }
  return [...map.values()].sort((a, b) => b.total - a.total);
});

const grandTotal = computed(() => totals.value.reduce((sum, item) => sum + item.total, 0));

const peakBucket = computed(() => {
  const map = new Map<string, number>();
  for (const point of points.value) {
    map.set(point.bucket, (map.get(point.bucket) ?? 0) + point.total);
  }
  let best = { bucket: '', total: 0 };
  for (const [bucket, total] of map.entries()) {
    if (total > best.total) best = { bucket, total };
  }
  return best;
});

const granularityLabel = computed(() => (result.value?.granularity === 'hour' ? '按小时' : '按天'));

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '请求失败';
}

async function load(): Promise<void> {
  loading.value = true;
  try {
    result.value = await fetchOverview(filters.value);
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

function share(total: number): number | null {
  return grandTotal.value > 0 ? total / grandTotal.value : null;
}
</script>

<template>
  <section class="page-card">
    <FilterBar v-if="ready" v-model="filters" :funnels="funnels" :loading="loading" @search="onSearch" />
    <el-skeleton v-else :rows="2" animated />
  </section>

  <section class="page-card">
    <div class="card-title">
      <h3>事件概览</h3>
      <span class="hint">
        {{ result ? `${result.appId} / ${result.env} · ${granularityLabel}聚合 · 时区 ${result.tzOffset}` : '等待数据' }}
      </span>
    </div>

    <div class="stat-grid">
      <div class="stat-item">
        <div class="label">事件总量</div>
        <div class="value">{{ formatNumber(grandTotal) }}<small>次</small></div>
      </div>
      <div class="stat-item">
        <div class="label">事件种类</div>
        <div class="value">{{ totals.length }}<small>种</small></div>
      </div>
      <div class="stat-item">
        <div class="label">峰值时间段</div>
        <div class="value" style="font-size: 15px">
          <template v-if="peakBucket.bucket">
            {{ peakBucket.bucket }}
            <small>{{ formatNumber(peakBucket.total) }}</small>
          </template>
          <template v-else>—</template>
        </div>
      </div>
      <div class="stat-item">
        <div class="label">统计区间</div>
        <div class="value" style="font-size: 13px; font-weight: 500">
          {{ formatDateTime(result?.from) }} ~ {{ formatDateTime(result?.to) }}
        </div>
      </div>
    </div>
  </section>

  <section v-loading="loading" class="page-card">
    <div class="card-title">
      <h3>趋势</h3>
      <el-radio-group v-model="metric" size="small">
        <el-radio-button value="total">事件量</el-radio-button>
        <el-radio-button value="uniqueActors">独立用户</el-radio-button>
      </el-radio-group>
    </div>
    <TrendChart v-if="points.length" :points="points" :metric="metric" />
    <el-empty v-else description="所选区间暂无数据" class="empty-block" />
  </section>

  <section class="page-card is-flush">
    <div style="padding: 18px 20px 0">
      <div class="card-title">
        <h3>事件明细</h3>
        <span class="hint">独立用户数为各时间桶去重后求和，非全区间去重</span>
      </div>
    </div>

    <el-table v-loading="loading" :data="totals" style="width: 100%">
      <el-table-column label="事件" min-width="220">
        <template #default="{ row }">
          <span>{{ eventLabel(row.event) }}</span>
          <span class="mono muted" style="margin-left: 8px">{{ row.event }}</span>
        </template>
      </el-table-column>
      <el-table-column label="触发量" width="140" align="right">
        <template #default="{ row }">{{ formatNumber(row.total) }}</template>
      </el-table-column>
      <el-table-column label="占比" width="120" align="right">
        <template #default="{ row }">{{ formatPercent(share(row.total)) }}</template>
      </el-table-column>
      <el-table-column label="独立用户（按桶求和）" width="200" align="right">
        <template #default="{ row }">{{ formatNumber(row.uniqueActors) }}</template>
      </el-table-column>

      <template #empty>
        <el-empty description="所选区间暂无数据" class="empty-block" />
      </template>
    </el-table>
  </section>
</template>
