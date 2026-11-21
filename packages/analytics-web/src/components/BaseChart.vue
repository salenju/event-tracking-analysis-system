<script setup lang="ts">
import { BarChart, FunnelChart, LineChart } from 'echarts/charts';
import {
  DataZoomComponent,
  GridComponent,
  LegendComponent,
  TitleComponent,
  TooltipComponent,
} from 'echarts/components';
import * as echarts from 'echarts/core';
import type { EChartsCoreOption } from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';
import { onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';

echarts.use([
  CanvasRenderer,
  BarChart,
  FunnelChart,
  LineChart,
  GridComponent,
  LegendComponent,
  TitleComponent,
  TooltipComponent,
  DataZoomComponent,
]);

type ChartInstance = ReturnType<typeof echarts.init>;

const props = withDefaults(
  defineProps<{
    option: EChartsCoreOption;
    height?: string;
  }>(),
  { height: '340px' },
);

const emit = defineEmits<{ (event: 'chart-click', dataIndex: number): void }>();

const container = ref<HTMLDivElement | null>(null);
const chart = shallowRef<ChartInstance | null>(null);
let observer: ResizeObserver | null = null;

onMounted(() => {
  if (!container.value) return;
  chart.value = echarts.init(container.value);
  chart.value.setOption(props.option, true);
  chart.value.on('click', (params) => {
    const index = (params as { dataIndex?: number }).dataIndex;
    if (typeof index === 'number') emit('chart-click', index);
  });
  observer = new ResizeObserver(() => chart.value?.resize());
  observer.observe(container.value);
});

watch(
  () => props.option,
  (option) => {
    chart.value?.setOption(option, true);
  },
  { deep: true },
);

onBeforeUnmount(() => {
  observer?.disconnect();
  observer = null;
  chart.value?.dispose();
  chart.value = null;
});
</script>

<template>
  <div ref="container" class="chart-container" :style="{ height }" />
</template>

<style scoped>
.chart-container {
  width: 100%;
}
</style>
