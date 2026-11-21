<script setup lang="ts">
import { ElMessage } from 'element-plus';
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { session, signOut } from '@/utils/session';

const route = useRoute();
const router = useRouter();

const activePath = computed(() => route.path);
const bare = computed(() => route.meta.bare === true);
const isAdmin = computed(() => session.user?.role === 'admin');

async function onUserCommand(command: string): Promise<void> {
  if (command !== 'logout') return;
  await signOut();
  ElMessage.success('已退出登录');
  await router.replace('/login');
}
</script>

<template>
  <router-view v-if="bare" />

  <div v-else class="app-shell">
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
        <el-menu-item index="/experience">体验指标</el-menu-item>
        <el-menu-item v-if="isAdmin" index="/admin">管理后台</el-menu-item>
      </el-menu>

      <el-dropdown v-if="session.user" trigger="click" @command="onUserCommand">
        <span class="user-entry">
          <el-avatar :size="26" :src="session.user.avatarUrl ?? undefined">
            {{ (session.user.name || '?').slice(0, 1).toUpperCase() }}
          </el-avatar>
          <span class="user-name">{{ session.user.name }}</span>
          <el-tag size="small" :type="session.user.role === 'admin' ? 'primary' : 'info'" effect="plain">
            {{ session.user.role === 'admin' ? '管理员' : '只读' }}
          </el-tag>
        </span>
        <template #dropdown>
          <el-dropdown-menu>
            <el-dropdown-item disabled>
              {{ session.user.email ?? session.user.openId ?? '本地账号' }}
            </el-dropdown-item>
            <el-dropdown-item divided command="logout">退出登录</el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>
      <router-link v-else-if="!session.authRequired" to="/login" class="login-link">去登录</router-link>
    </header>

    <main class="app-main">
      <router-view />
    </main>
  </div>
</template>

<style scoped>
.user-entry {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  outline: none;
}

.user-name {
  font-size: 13px;
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.login-link {
  color: var(--accent);
  font-size: 13px;
  text-decoration: none;
}
</style>
