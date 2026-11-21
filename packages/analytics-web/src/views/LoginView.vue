<script setup lang="ts">
import { ElMessage } from 'element-plus';
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { devLogin, fetchFeishuLoginUrl } from '@/api/auth';
import { applyLogin, ensureAuthConfig, ensureSession, session } from '@/utils/session';
import { getToken, setToken } from '@/utils/token';

const route = useRoute();
const router = useRouter();

const tab = ref<'qr' | 'redirect'>('qr');
const qrUrl = ref('');
const loadingQr = ref(false);
const errorText = ref('');
const devUsername = ref('admin');
const devLoading = ref(false);

const redirectTarget = (): string => {
  const raw = route.query.redirect;
  const value = typeof raw === 'string' ? raw : '';
  return value.startsWith('/') && !value.startsWith('//') ? value : '/funnel';
};

function goNext(): void {
  void router.replace(redirectTarget());
}

async function loadQr(): Promise<void> {
  if (!session.feishuEnabled) return;
  loadingQr.value = true;
  try {
    const { url } = await fetchFeishuLoginUrl('qr');
    qrUrl.value = url;
  } catch (error) {
    errorText.value = error instanceof Error ? error.message : '获取飞书登录二维码失败';
  } finally {
    loadingQr.value = false;
  }
}

async function startRedirectLogin(): Promise<void> {
  try {
    const { url } = await fetchFeishuLoginUrl('redirect');
    window.location.assign(url);
  } catch (error) {
    errorText.value = error instanceof Error ? error.message : '跳转飞书授权页失败';
  }
}

async function submitDevLogin(): Promise<void> {
  devLoading.value = true;
  try {
    const result = await devLogin(devUsername.value.trim());
    applyLogin(result.user, result.token);
    ElMessage.success(`已登录：${result.user.name}`);
    goNext();
  } catch (error) {
    errorText.value = error instanceof Error ? error.message : '本地登录失败';
  } finally {
    devLoading.value = false;
  }
}

/**
 * 扫码登录的回调发生在内嵌 iframe 里，由后端回调页 postMessage 把 token 传过来。
 * 这里不信任来源（生产环境回调域名可能与看板不同），因此拿到 token 后必须回服务端换用户信息。
 */
async function onMessage(event: MessageEvent): Promise<void> {
  const data = event.data as { type?: string; token?: string; error?: string } | null;
  if (!data || data.type !== 'track-admin-login') return;
  if (data.error) {
    errorText.value = data.error;
    return;
  }
  if (!data.token) return;

  setToken(data.token);
  const user = await ensureSession(true);
  if (!user) {
    setToken(null);
    errorText.value = '登录凭证无效，请重新扫码';
    return;
  }
  ElMessage.success(`已登录：${user.name}`);
  goNext();
}

onMounted(async () => {
  const queryError = route.query.error;
  if (typeof queryError === 'string' && queryError) errorText.value = queryError;

  await ensureAuthConfig();
  if (getToken()) {
    const user = await ensureSession(true);
    if (user) {
      goNext();
      return;
    }
  }
  window.addEventListener('message', onMessage);
  await loadQr();
});

onBeforeUnmount(() => {
  window.removeEventListener('message', onMessage);
});
</script>

<template>
  <div class="login-page">
    <div class="login-panel">
      <div class="brand-mark">ET</div>
      <h1>埋点分析看板</h1>
      <p class="subtitle">Event Tracking Analytics</p>
      <ul class="feature-list">
        <li>收银台转化漏斗与流失下钻</li>
        <li>事件趋势与体验指标</li>
        <li>应用凭据统一颁发与轮换</li>
      </ul>
      <p class="footnote">使用飞书账号登录，权限由管理员分配</p>
    </div>

    <div class="login-card">
      <h2>登录</h2>
      <p class="hint">扫码或授权登录后即可访问看板</p>

      <el-alert v-if="errorText" :title="errorText" type="error" show-icon :closable="false" class="alert" />

      <template v-if="session.feishuEnabled">
        <el-tabs v-model="tab" class="login-tabs">
          <el-tab-pane label="扫码登录" name="qr">
            <div v-loading="loadingQr" class="qr-box">
              <iframe
                v-if="qrUrl"
                :key="qrUrl"
                :src="qrUrl"
                class="qr-frame"
                title="飞书扫码登录"
                referrerpolicy="no-referrer"
              />
              <el-empty v-else-if="!loadingQr" description="二维码加载失败" :image-size="72" />
            </div>
            <div class="qr-actions">
              <el-button text type="primary" @click="loadQr">刷新二维码</el-button>
              <el-button v-if="qrUrl" text type="primary" @click="startRedirectLogin">在新窗口打开</el-button>
            </div>
            <p class="tips">用飞书 App 扫描二维码，并在手机上确认授权</p>
          </el-tab-pane>

          <el-tab-pane label="授权登录" name="redirect">
            <div class="redirect-box">
              <p>点击下方按钮跳转到飞书授权页，确认授权后自动返回看板。</p>
              <el-button type="primary" size="large" class="wide-btn" @click="startRedirectLogin">
                前往飞书授权
              </el-button>
            </div>
          </el-tab-pane>
        </el-tabs>
      </template>

      <el-alert
        v-else
        type="warning"
        show-icon
        :closable="false"
        title="飞书登录未配置"
        description="服务端需要设置 FEISHU_APP_ID / FEISHU_APP_SECRET / FEISHU_REDIRECT_URI，并在飞书开放平台把该地址加入重定向白名单。"
        class="alert"
      />

      <div v-if="session.devLoginEnabled" class="dev-box">
        <el-divider>本地调试登录</el-divider>
        <div class="dev-row">
          <el-input v-model="devUsername" placeholder="用户名，如 admin" @keyup.enter="submitDevLogin" />
          <el-button :loading="devLoading" @click="submitDevLogin">登录</el-button>
        </div>
        <p class="tips">仅非生产环境可用，用于本地验证权限链路</p>
      </div>

      <p v-if="!session.authRequired" class="tips center">
        当前服务未开启强制登录（AUTH_REQUIRED=false），可直接
        <router-link to="/funnel">进入看板</router-link>；管理后台仍需要登录身份。
      </p>
    </div>
  </div>
</template>

<style scoped>
.login-page {
  min-height: 100vh;
  display: grid;
  grid-template-columns: 1.05fr 1fr;
  background: var(--page-bg);
}

.login-panel {
  position: relative;
  padding: 64px 56px;
  color: #fff;
  background: linear-gradient(150deg, #1b3fbe 0%, #2f6bff 45%, #6f9bff 100%);
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 14px;
}

.login-panel .brand-mark {
  width: 44px;
  height: 44px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.18);
  border: 1px solid rgba(255, 255, 255, 0.35);
}

.login-panel h1 {
  font-size: 26px;
  margin: 8px 0 0;
}

.login-panel .subtitle {
  margin: 0;
  color: rgba(255, 255, 255, 0.75);
  letter-spacing: 0.6px;
  font-size: 13px;
}

.feature-list {
  margin: 18px 0 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 10px;
  font-size: 14px;
  color: rgba(255, 255, 255, 0.9);
}

.feature-list li::before {
  content: '·';
  margin-right: 8px;
  opacity: 0.7;
}

.footnote {
  margin-top: 12px;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.65);
}

.login-card {
  width: 100%;
  max-width: 420px;
  margin: auto;
  padding: 32px;
  background: var(--card-bg);
  border: 1px solid var(--border-soft);
  border-radius: 16px;
}

.login-card h2 {
  margin: 0 0 6px;
  font-size: 20px;
}

.login-card .hint {
  margin: 0 0 16px;
  color: var(--text-muted);
  font-size: 13px;
}

.alert {
  margin-bottom: 14px;
}

.login-tabs :deep(.el-tabs__content) {
  padding-top: 4px;
}

.qr-box {
  min-height: 320px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #fbfcfe;
  border: 1px dashed var(--border-soft);
  border-radius: 10px;
  overflow: hidden;
}

.qr-frame {
  width: 100%;
  height: 380px;
  border: 0;
  background: #fff;
}

.qr-actions {
  display: flex;
  justify-content: center;
  gap: 4px;
  margin-top: 6px;
}

.redirect-box {
  min-height: 260px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 16px;
  color: var(--text-muted);
  font-size: 13px;
}

.wide-btn {
  width: 100%;
}

.tips {
  color: var(--text-muted);
  font-size: 12px;
  margin: 6px 0 0;
}

.tips.center {
  text-align: center;
}

.dev-box {
  margin-top: 8px;
}

.dev-row {
  display: flex;
  gap: 8px;
}

@media (max-width: 860px) {
  .login-page {
    grid-template-columns: 1fr;
  }

  .login-panel {
    display: none;
  }

  .login-card {
    margin: 24px 16px;
    padding: 24px 20px;
  }
}
</style>
