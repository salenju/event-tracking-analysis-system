<script setup lang="ts">
import { computed } from 'vue';
import type { FilterQuery, FunnelDef } from '@/api/types';
import { defaultRange, rangeShortcuts } from '@/utils/filters';

const props = defineProps<{
  funnels: FunnelDef[];
  modelValue: FilterQuery;
  loading?: boolean;
}>();

const emit = defineEmits<{
  (event: 'update:modelValue', value: FilterQuery): void;
  (event: 'search', value: FilterQuery): void;
}>();

const shortcuts = rangeShortcuts();

const range = computed<[Date, Date]>(() => [
  new Date(props.modelValue.from),
  new Date(props.modelValue.to),
]);

function update(patch: Partial<FilterQuery>): void {
  emit('update:modelValue', { ...props.modelValue, ...patch });
}

function onKeyChange(value: string): void {
  const funnel = props.funnels.find((item) => item.key === value);
  update({
    key: value,
    ...(funnel ? { appId: funnel.appId, env: funnel.env } : {}),
  });
}

function onAppIdInput(value: string): void {
  update({ appId: value });
}

function onEnvChange(value: string): void {
  update({ env: value });
}

function onWalletTypeInput(value: string): void {
  update({ walletType: value });
}

function onCountryInput(value: string): void {
  update({ country: value.trim().toUpperCase() });
}

function onDeviceChange(value: string): void {
  update({ deviceType: value });
}

function onRangeChange(value: unknown): void {
  const next = value as [Date, Date] | null;
  if (!next || next.length !== 2) return;
  update({ from: next[0].toISOString(), to: next[1].toISOString() });
}

function reset(): void {
  const funnel = props.funnels.find((item) => item.key === props.modelValue.key) ?? props.funnels[0];
  const [from, to] = defaultRange(7);
  const next: FilterQuery = {
    key: funnel?.key ?? '',
    appId: funnel?.appId ?? '',
    env: funnel?.env ?? 'prod',
    walletType: '',
    country: '',
    deviceType: '',
    from: from.toISOString(),
    to: to.toISOString(),
  };
  emit('update:modelValue', next);
  emit('search', next);
}
</script>

<template>
  <el-form :inline="true" class="filter-form" @submit.prevent>
    <el-form-item label="漏斗">
      <el-select :model-value="modelValue.key" style="width: 170px" @change="onKeyChange">
        <el-option v-for="item in funnels" :key="item.key" :label="item.name" :value="item.key" />
      </el-select>
    </el-form-item>

    <el-form-item label="应用">
      <el-input :model-value="modelValue.appId" style="width: 190px" @update:model-value="onAppIdInput" />
    </el-form-item>

    <el-form-item label="环境">
      <el-select :model-value="modelValue.env" style="width: 108px" @change="onEnvChange">
        <el-option label="prod" value="prod" />
        <el-option label="test" value="test" />
        <el-option label="staging" value="staging" />
      </el-select>
    </el-form-item>

    <el-form-item label="钱包类型">
      <el-input
        :model-value="modelValue.walletType"
        placeholder="全部"
        clearable
        style="width: 150px"
        @update:model-value="onWalletTypeInput"
      />
    </el-form-item>

    <el-form-item label="国家">
      <el-input
        :model-value="modelValue.country"
        placeholder="全部"
        maxlength="2"
        clearable
        style="width: 96px"
        @update:model-value="onCountryInput"
      />
    </el-form-item>

    <el-form-item label="设备">
      <el-select :model-value="modelValue.deviceType" placeholder="全部" clearable style="width: 120px" @change="onDeviceChange">
        <el-option label="全部" value="" />
        <el-option label="桌面端" value="desktop" />
        <el-option label="移动端" value="mobile" />
        <el-option label="平板" value="tablet" />
      </el-select>
    </el-form-item>

    <el-form-item label="时间">
      <el-date-picker
        :model-value="range"
        type="datetimerange"
        :shortcuts="shortcuts"
        range-separator="~"
        start-placeholder="开始时间"
        end-placeholder="结束时间"
        :clearable="false"
        style="width: 380px"
        @update:model-value="onRangeChange"
      />
    </el-form-item>

    <el-form-item>
      <el-button type="primary" :loading="loading" @click="emit('search', modelValue)">查询</el-button>
      <el-button :disabled="loading" @click="reset">重置</el-button>
    </el-form-item>
  </el-form>
</template>

<style scoped>
.filter-form {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  row-gap: 4px;
}

.filter-form :deep(.el-form-item) {
  margin-right: 12px;
  margin-bottom: 8px;
}
</style>
