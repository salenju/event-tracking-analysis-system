<script setup lang="ts">
import { ElMessage } from 'element-plus';
import { computed, ref, watch } from 'vue';
import { fetchDropOffSessions, fetchSessionDetail } from '@/api/track';
import type { DropOffSession, FilterQuery, SessionDetail } from '@/api/types';
import { eventLabel, formatDateTime, formatTime, prettyJson, shortId } from '@/utils/format';

const PAGE_SIZE = 20;

const props = defineProps<{
  modelValue: boolean;
  query: FilterQuery;
  stepIndex: number;
  stepEvent: string;
}>();

const emit = defineEmits<{ (event: 'update:modelValue', value: boolean): void }>();

const sessions = ref<DropOffSession[]>([]);
const hasMore = ref(false);
const loading = ref(false);
const offset = ref(0);

const detailVisible = ref(false);
const detailLoading = ref(false);
const detail = ref<SessionDetail | null>(null);

const visible = computed({
  get: () => props.modelValue,
  set: (value: boolean) => emit('update:modelValue', value),
});

const stepLabel = computed(() => eventLabel(props.stepEvent));

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '请求失败';
}

async function loadMore(): Promise<void> {
  loading.value = true;
  try {
    const result = await fetchDropOffSessions(props.query, props.stepIndex, {
      limit: PAGE_SIZE,
      offset: offset.value,
    });
    sessions.value = offset.value === 0 ? result.sessions : [...sessions.value, ...result.sessions];
    hasMore.value = result.hasMore;
    offset.value += result.sessions.length;
  } catch (error) {
    ElMessage.error(errorMessage(error));
  } finally {
    loading.value = false;
  }
}

async function reload(): Promise<void> {
  offset.value = 0;
  sessions.value = [];
  hasMore.value = false;
  await loadMore();
}

async function openDetail(sessionId: string): Promise<void> {
  detailVisible.value = true;
  detailLoading.value = true;
  detail.value = null;
  try {
    detail.value = await fetchSessionDetail(sessionId, {
      key: props.query.key,
      appId: props.query.appId,
      env: props.query.env,
    });
  } catch (error) {
    ElMessage.error(errorMessage(error));
  } finally {
    detailLoading.value = false;
  }
}

function timelineType(item: { event: string | null }): 'primary' | 'success' | 'danger' | 'info' {
  if (item.event === 'pay_success') return 'success';
  if (item.event === 'pay_failed') return 'danger';
  return item.event ? 'primary' : 'info';
}

watch(
  () => [props.modelValue, props.stepIndex, props.query.key, props.query.from, props.query.to],
  () => {
    if (props.modelValue) void reload();
  },
  { immediate: true },
);
</script>

<template>
  <el-drawer v-model="visible" size="720px" :destroy-on-close="false">
    <template #header>
      <div>
        <strong>「{{ stepLabel }}」环节流失会话</strong>
        <div class="muted" style="font-size: 12px; margin-top: 2px">
          到达上一步但未到达 {{ stepLabel }}，共 {{ sessions.length }}{{ hasMore ? '+' : '' }} 个
        </div>
      </div>
    </template>

    <div class="drawer-toolbar">
      <span class="muted" style="font-size: 12px">会话按最后到达时间倒序排列</span>
      <el-button :loading="loading" size="small" @click="reload">刷新</el-button>
    </div>

    <el-table v-loading="loading" :data="sessions" size="small" border style="width: 100%">
      <el-table-column label="会话 ID" min-width="220">
        <template #default="{ row }">
          <span class="mono">{{ shortId(row.sessionId, 10) }}</span>
        </template>
      </el-table-column>
      <el-table-column label="会话开始" width="180">
        <template #default="{ row }">{{ formatDateTime(row.startedAt) }}</template>
      </el-table-column>
      <el-table-column label="最后到达" width="180">
        <template #default="{ row }">{{ formatDateTime(row.lastStepAt) }}</template>
      </el-table-column>
      <el-table-column label="操作" width="110" align="right">
        <template #default="{ row }">
          <el-button link type="primary" @click="openDetail(row.sessionId)">查看轨迹</el-button>
        </template>
      </el-table-column>
    </el-table>

    <div v-if="hasMore" style="text-align: center; margin-top: 14px">
      <el-button :loading="loading" @click="loadMore">加载更多</el-button>
    </div>

    <el-empty v-if="!loading && !sessions.length" description="该环节暂无流失会话" class="empty-block" />
  </el-drawer>

  <el-drawer v-model="detailVisible" size="560px" append-to-body title="会话事件轨迹">
    <div v-loading="detailLoading">
      <template v-if="detail">
        <div class="stat-grid" style="margin-bottom: 16px">
          <div class="stat-item">
            <div class="label">会话 ID</div>
            <div class="value mono" style="font-size: 12px">{{ detail.sessionId }}</div>
          </div>
          <div class="stat-item">
            <div class="label">事件数</div>
            <div class="value">{{ detail.events.length }}</div>
          </div>
        </div>

        <el-timeline>
          <el-timeline-item
            v-for="(item, index) in detail.events"
            :key="`${item.occurredAt}-${index}`"
            :timestamp="formatTime(item.occurredAt)"
            :type="timelineType(item)"
            placement="top"
          >
            <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap">
              <strong>{{ eventLabel(item.event) }}</strong>
              <span class="mono muted">{{ item.event ?? item.recordType }}</span>
              <el-tag v-if="item.walletType" size="small" type="info">{{ item.walletType }}</el-tag>
              <el-tag v-if="item.failReason" size="small" type="danger">{{ item.failReason }}</el-tag>
            </div>
            <div class="muted" style="font-size: 12px; margin-top: 2px">
              {{ formatDateTime(item.occurredAt) }}
              <span v-if="item.orderId"> · 订单 {{ item.orderId }}</span>
              <span v-if="item.userId"> · 用户 {{ shortId(item.userId, 6) }}</span>
            </div>
            <pre
              v-if="item.recordType === 'event' && item.properties"
              class="properties-block"
            >{{ prettyJson(item.properties) }}</pre>
          </el-timeline-item>
        </el-timeline>

        <el-empty v-if="!detail.events.length" description="该会话没有事件记录" />
      </template>
    </div>
  </el-drawer>
</template>
