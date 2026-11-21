import { createRouter, createWebHistory } from 'vue-router';
import { ensureAuthConfig, ensureSession, session } from '@/utils/session';

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/funnel' },
    {
      path: '/login',
      name: 'login',
      component: () => import('@/views/LoginView.vue'),
      meta: { title: '登录', public: true, bare: true },
    },
    {
      path: '/login/callback',
      name: 'login-callback',
      component: () => import('@/views/LoginCallbackView.vue'),
      meta: { title: '登录中', public: true, bare: true },
    },
    {
      path: '/funnel',
      name: 'funnel',
      component: () => import('@/views/FunnelView.vue'),
      meta: { title: '转化漏斗' },
    },
    {
      path: '/overview',
      name: 'overview',
      component: () => import('@/views/OverviewView.vue'),
      meta: { title: '事件概览' },
    },
    {
      path: '/experience',
      name: 'experience',
      component: () => import('@/views/ExperienceView.vue'),
      meta: { title: '体验指标' },
    },
    {
      path: '/admin',
      name: 'admin',
      component: () => import('@/views/AdminView.vue'),
      meta: { title: '管理后台' },
    },
    { path: '/:pathMatch(.*)*', redirect: '/funnel' },
  ],
});

router.beforeEach(async (to) => {
  await ensureAuthConfig();
  const user = await ensureSession();

  if (to.meta.public === true) {
    // 已登录用户不需要再看登录页
    if (user && to.path === '/login') return { path: '/funnel' };
    return true;
  }

  // 服务端未开启鉴权（本地调试）时直接放行，页面照常可用
  if (!user && session.authRequired) {
    return { path: '/login', query: { redirect: to.fullPath } };
  }
  return true;
});

router.afterEach((to) => {
  const title = (to.meta.title as string | undefined) ?? '埋点分析看板';
  document.title = `${title} · 埋点分析看板`;
});

export default router;
