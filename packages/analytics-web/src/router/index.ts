import { createRouter, createWebHistory } from 'vue-router';

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/funnel' },
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
    { path: '/:pathMatch(.*)*', redirect: '/funnel' },
  ],
});

router.afterEach((to) => {
  const title = (to.meta.title as string | undefined) ?? '埋点分析看板';
  document.title = `${title} · 埋点分析看板`;
});

export default router;
