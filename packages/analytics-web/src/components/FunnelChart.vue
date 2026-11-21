<script setup lang="ts">
import type { EChartsCoreOption } from 'echarts/core';
import { computed } from 'vue';
import type { FunnelStep } from '@/api/types';
import { eventLabel, formatNumber, formatPercent } from '@/utils/format';
import BaseChart from './BaseChart.vue';

const props = defineProps<{ steps: FunnelStep[] }>();
const emit = defineEmits<{ (event: 'step-click', index: number): void }>();

const COLORS = ['#2f6bff', '#4d86ff', '#6fa1ff', '#93bcff', '#b7d3ff', '#d3e4ff'];

const option = computed<EChartsCoreOption>(() => {
  const steps = props.steps;
  return {
    tooltip: {
      trigger: 'item',
      formatter: (params: unknown) => {
        const item = params as { dataIndex: number };
        const step = steps[item.dataIndex];
        if (!step) return '';
        return [
          `<b>${eventLabel(step.event)}</b>`,
          `到达会话：${formatNumber(step.count)}`,
          `相对上一步：${formatPercent(step.rateFromPrevious)}`,
          `总转化率：${formatPercent(step.rateFromStart)}`,
        ].join('<br/>');
      },
    },
    series: [
      {
        type: 'funnel',
        sort: 'none',
        left: '8%',
        right: '8%',
        top: 16,
        bottom: 12,
        minSize: '22%',
        maxSize: '100%',
        gap: 6,
        label: {
          show: true,
          position: 'inside',
          color: '#fff',
          fontSize: 12,
          fontWeight: 500,
          formatter: (params: unknown) => {
            const item = params as { dataIndex: number };
            const step = steps[item.dataIndex];
            if (!step) return '';
            return `${eventLabel(step.event)}  ${formatNumber(step.count)}`;
          },
        },
        itemStyle: { borderWidth: 0 },
        emphasis: { label: { fontSize: 13, fontWeight: 600 } },
        data: steps.map((step, index) => ({
          name: eventLabel(step.event),
          value: step.count,
          itemStyle: { color: COLORS[index % COLORS.length] },
        })),
      },
    ],
  };
});
</script>

<template>
  <BaseChart :option="option" height="320px" @chart-click="emit('step-click', $event)" />
</template>
