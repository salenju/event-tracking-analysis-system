<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';

const route = useRoute();
const activePath = computed(() => route.path);
</script>

<template>
  <div class="app-shell">
    <header class="app-header">
      <div class="brand">
        <span class="brand-mark">ET</span>
        <div class="brand-text">
          <strong>埋点分析看板</strong>
          <small>Event Tracking Analytics</small>
        </div>
      </div>
      <el-menu :default-active="activePath" mode="horizontal" router class="app-nav">
        <el-menu-item index="/funnel">转化漏斗</el-menu-item>
        <el-menu-item index="/overview">事件概览</el-menu-item>
      </el-menu>
    </header>

    <main class="app-main">
      <router-view />
    </main>
  </div>
</template>
