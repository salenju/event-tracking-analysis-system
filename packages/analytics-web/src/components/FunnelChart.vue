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
        minSize: '30%',
        maxSize: '100%',
        gap: 4,
        label: {
          show: true,
          position: 'inside',
          formatter: (params: unknown) => {
            const item = params as { dataIndex: number };
            const step = steps[item.dataIndex];
            if (!step) return '';
            // 第一行：步骤名 + 到达人数；第二行：相对上一步转化率 + 总转化率
            const stepRate = step.index === 0 ? '起点' : formatPercent(step.rateFromPrevious);
            return [
              `{name|${eventLabel(step.event)}  ${formatNumber(step.count)}}`,
              `{stepRate|转化 ${stepRate}}{gap| · }{totalRate|总 ${formatPercent(step.rateFromStart)}}`,
            ].join('\n');
          },
          rich: {
            name: { fontSize: 12, fontWeight: 600, color: '#fff', lineHeight: 19 },
            stepRate: { fontSize: 11, color: '#fff', lineHeight: 15 },
            gap: { fontSize: 11, color: 'rgba(255,255,255,0.65)', lineHeight: 15 },
            totalRate: { fontSize: 11, color: 'rgba(255,255,255,0.85)', lineHeight: 15 },
          },
        },
        itemStyle: { borderWidth: 0 },
        emphasis: { label: { show: true } },
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
  <BaseChart :option="option" height="360px" @chart-click="emit('step-click', $event)" />
</template>
