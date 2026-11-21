<script setup lang="ts">
import { ElMessage } from 'element-plus';
import { computed, onMounted, ref } from 'vue';
import { fetchFunnel, fetchFunnels } from '@/api/track';
import type { FilterQuery, FunnelDef, FunnelResult, FunnelStep } from '@/api/types';
import FilterBar from '@/components/FilterBar.vue';
import FunnelChart from '@/components/FunnelChart.vue';
import SessionDrawer from '@/components/SessionDrawer.vue';
import { buildDefaultQuery, createEmptyQuery } from '@/utils/filters';
import { eventLabel, formatDateTime, formatNumber, formatPercent } from '@/utils/format';

const funnels = ref<FunnelDef[]>([]);
const filters = ref<FilterQuery>(createEmptyQuery());
const ready = ref(false);
const loading = ref(false);
const result = ref<FunnelResult | null>(null);

const drawerVisible = ref(false);
const drawerStep = ref<{ index: number; event: string }>({ index: 1, event: '' });

const steps = computed<FunnelStep[]>(() => result.value?.steps ?? []);
const firstCount = computed(() => steps.value[0]?.count ?? 0);
const lastCount = computed(() => steps.value[steps.value.length - 1]?.count ?? 0);
const overallRate = computed(() => (firstCount.value > 0 ? lastCount.value / firstCount.value : null));

/** 流失最多的环节（不含首步） */
const worstStep = computed<FunnelStep | null>(() => {
  let worst: FunnelStep | null = null;
  for (const step of steps.value) {
    if (step.index === 0) continue;
    if (!worst || (step.dropFromPrevious ?? 0) > (worst.dropFromPrevious ?? 0)) worst = step;
  }
  return worst;
});

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '请求失败';
}

async function load(): Promise<void> {
  loading.value = true;
  try {
    result.value = await fetchFunnel(filters.value);
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

function openDropOff(step: FunnelStep): void {
  if (step.index < 1) {
    ElMessage.info('首步没有上游流失可查看');
    return;
  }
  drawerStep.value = { index: step.index, event: step.event };
  drawerVisible.value = true;
}

function barPercent(count: number): number {
  if (firstCount.value <= 0) return 0;
  return Math.max(Math.round((count / firstCount.value) * 100), count > 0 ? 2 : 0);
}

function onChartClick(index: number): void {
  const step = steps.value[index];
  if (step) openDropOff(step);
}
</script>

<template>
  <section class="page-card">
    <FilterBar v-if="ready" v-model="filters" :funnels="funnels" :loading="loading" @search="onSearch" />
    <el-skeleton v-else :rows="2" animated />
  </section>

  <section class="page-card">
    <div class="card-title">
      <h3>{{ result?.name ?? '转化漏斗' }}</h3>
      <span class="hint" v-if="result">
        {{ result.appId }} / {{ result.env }} · 会话口径 · 窗口 {{ result.windowMinutes }} 分钟
        <template v-if="result.walletType"> · 钱包 {{ result.walletType }}</template>
      </span>
      <span class="hint" v-else>等待数据</span>
    </div>

    <div class="stat-grid">
      <div class="stat-item">
        <div class="label">首步会话数</div>
        <div class="value">{{ formatNumber(firstCount) }}<small>个</small></div>
      </div>
      <div class="stat-item">
        <div class="label">完成末步会话数</div>
        <div class="value">{{ formatNumber(lastCount) }}<small>个</small></div>
      </div>
      <div class="stat-item">
        <div class="label">整体转化率</div>
        <div class="value">{{ formatPercent(overallRate) }}</div>
      </div>
      <div class="stat-item">
        <div class="label">最大流失环节</div>
        <div class="value" style="font-size: 16px">
          {{ worstStep ? eventLabel(worstStep.event) : '—' }}
          <small v-if="worstStep">流失 {{ formatNumber(worstStep.dropFromPrevious) }}</small>
        </div>
      </div>
    </div>

    <div class="muted" style="font-size: 12px; margin-top: 12px">
      统计区间：{{ formatDateTime(result?.from) }} ~ {{ formatDateTime(result?.to) }} ·
      仅统计 record_type=event 且按 session_id 去重
    </div>
  </section>

  <section v-loading="loading" class="page-card">
    <div class="card-title">
      <h3>漏斗图</h3>
      <span class="hint">
        每个色块：第一行 环节与到达会话数，第二行 相对上一步转化率 · 总转化率；点击色块查看该环节流失会话
      </span>
    </div>
    <FunnelChart v-if="steps.length" :steps="steps" @step-click="onChartClick" />
    <el-empty v-else description="所选区间暂无数据" class="empty-block" />
  </section>

  <section class="page-card is-flush">
    <div style="padding: 18px 20px 0">
      <div class="card-title">
        <h3>分步转化</h3>
        <span class="hint">点击行可查看该步流失的用户会话轨迹</span>
      </div>
    </div>

    <el-table
      v-loading="loading"
      :data="steps"
      class="funnel-table"
      style="width: 100%"
      @row-click="openDropOff"
    >
      <el-table-column label="环节" min-width="240">
        <template #default="{ row }">
          <span class="step-index">{{ row.index + 1 }}</span>
          <span>{{ eventLabel(row.event) }}</span>
          <span class="mono muted" style="margin-left: 8px">{{ row.event }}</span>
        </template>
      </el-table-column>

      <el-table-column label="到达会话" min-width="220">
        <template #default="{ row }">
          <div class="bar-cell">
            <div class="bar-track">
              <div class="bar-fill" :style="{ width: `${barPercent(row.count)}%` }" />
            </div>
            <span class="bar-value">{{ formatNumber(row.count) }}</span>
          </div>
        </template>
      </el-table-column>

      <el-table-column label="相对上一步" width="190">
        <template #default="{ row }">
          <template v-if="row.index === 0">
            <span class="muted">起点</span>
          </template>
          <template v-else>
            <span>{{ formatPercent(row.rateFromPrevious) }}</span>
            <span class="muted" style="margin-left: 6px; font-size: 12px">
              流失 {{ formatNumber(row.dropFromPrevious) }}
            </span>
          </template>
        </template>
      </el-table-column>

      <el-table-column label="总转化率" width="120">
        <template #default="{ row }">{{ formatPercent(row.rateFromStart) }}</template>
      </el-table-column>

      <el-table-column label="操作" width="120" align="right">
        <template #default="{ row }">
          <el-button
            link
            type="primary"
            :disabled="row.index === 0"
            @click.stop="openDropOff(row)"
          >
            查看流失
          </el-button>
        </template>
      </el-table-column>

      <template #empty>
        <el-empty description="所选区间暂无数据" class="empty-block" />
      </template>
    </el-table>
  </section>

  <SessionDrawer
    v-if="ready"
    v-model="drawerVisible"
    :query="filters"
    :step-index="drawerStep.index"
    :step-event="drawerStep.event"
  />
</template>
