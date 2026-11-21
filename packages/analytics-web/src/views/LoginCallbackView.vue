<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ensureSession } from '@/utils/session';
import { setToken } from '@/utils/token';

const router = useRouter();
const failed = ref('');

onMounted(async () => {
  // 授权登录模式：token 放在 fragment，不经过服务端日志
  const hash = window.location.hash.startsWith('#') ? window.location.hash.slice(1) : window.location.hash;
  const token = new URLSearchParams(hash).get('token');

  if (!token) {
    failed.value = '登录回调缺少凭证，请重新登录';
    return;
  }

  setToken(token);
  const user = await ensureSession(true);
  if (!user) {
    setToken(null);
    failed.value = '登录凭证已失效，请重新登录';
    return;
  }
  // 清掉地址栏里的 token，避免被复制或留在浏览器历史里
  void router.replace('/funnel');
});
</script>

<template>
  <div class="callback-page">
    <el-result v-if="failed" icon="error" title="登录失败" :sub-title="failed">
      <template #extra>
        <el-button type="primary" @click="$router.replace('/login')">返回登录</el-button>
      </template>
    </el-result>
    <div v-else v-loading="true" class="loading-box" element-loading-text="正在完成登录…" />
  </div>
</template>

<style scoped>
.callback-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--page-bg);
}

.loading-box {
  width: 320px;
  height: 160px;
}
</style>
