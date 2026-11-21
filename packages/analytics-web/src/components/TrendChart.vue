<script setup lang="ts">
import type { EChartsCoreOption } from 'echarts/core';
import { computed } from 'vue';
import type { OverviewPoint } from '@/api/types';
import { eventLabel, formatNumber } from '@/utils/format';
import BaseChart from './BaseChart.vue';

const props = defineProps<{
  points: OverviewPoint[];
  metric: 'total' | 'uniqueActors';
}>();

const buckets = computed(() => [...new Set(props.points.map((item) => item.bucket))].sort());

const events = computed(() => {
  const totals = new Map<string, number>();
  for (const item of props.points) {
    totals.set(item.event, (totals.get(item.event) ?? 0) + item.total);
  }
  return [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([event]) => event);
});

const lookup = computed(() => {
  const map = new Map<string, OverviewPoint>();
  for (const item of props.points) map.set(`${item.event}|${item.bucket}`, item);
  return map;
});

const option = computed<EChartsCoreOption>(() => {
  const metric = props.metric;
  const labels = buckets.value;
  return {
    tooltip: { trigger: 'axis' },
    legend: { top: 0, type: 'scroll' },
    grid: { left: 56, right: 24, top: 44, bottom: 44 },
    dataZoom: labels.length > 24 ? [{ type: 'inside' }, { type: 'slider', height: 14, bottom: 8 }] : [],
    xAxis: {
      type: 'category',
      data: labels,
      boundaryGap: false,
      axisLabel: { hideOverlap: true, fontSize: 11 },
    },
    yAxis: {
      type: 'value',
      axisLabel: { formatter: (value: number) => formatNumber(value) },
      splitLine: { lineStyle: { type: 'dashed', color: '#eef1f6' } },
    },
    series: events.value.map((event) => ({
      name: eventLabel(event),
      type: 'line',
      smooth: true,
      showSymbol: false,
      lineStyle: { width: 2 },
      data: labels.map((bucket) => lookup.value.get(`${event}|${bucket}`)?.[metric] ?? 0),
    })),
  };
});
</script>

<template>
  <BaseChart :option="option" height="360px" />
</template>
