<script setup lang="ts">
import { ElMessage, ElMessageBox } from 'element-plus';
import { computed, onMounted, reactive, ref } from 'vue';
import {
  createApp,
  deleteApp,
  fetchApps,
  fetchUsers,
  rotateAppSecret,
  updateApp,
  updateUser,
  type AdminApp,
  type AppStatus,
  type SigningInfo,
} from '@/api/admin';
import type { AuthUser, UserRole } from '@/api/auth';
import { ApiError } from '@/api/client';
import { ENV_OPTIONS } from '@/utils/filters';
import { formatDateTime } from '@/utils/format';
import { ensureSession, session } from '@/utils/session';

const activeTab = ref<'apps' | 'users'>('apps');
const forbidden = ref(false);

const apps = ref<AdminApp[]>([]);
const signing = ref<SigningInfo | null>(null);
const appsLoading = ref(false);

const users = ref<AuthUser[]>([]);
const usersLoading = ref(false);

const createVisible = ref(false);
const createForm = reactive({ name: '', env: 'prod', remark: '' });
const creating = ref(false);

const secretVisible = ref(false);
const secretPayload = ref<{ app: AdminApp | null; secret: string }>({ app: null, secret: '' });

const isAdmin = computed(() => session.user?.role === 'admin');
const currentUserId = computed(() => session.user?.id ?? null);

/** 对外可达的埋点服务地址：服务端配置优先，否则用当前站点 origin */
const trackBaseUrl = computed(() => {
  const configured = signing.value?.publicBaseUrl?.trim();
  return (configured || window.location.origin).replace(/\/+$/, '');
});

/** 默认上报地址：SDK 不传 serverUrl 时用它（也就是本系统，数据进本看板） */
const defaultTrackUrl = computed(() => `${trackBaseUrl.value}${signing.value?.trackPath || '/api/track'}`);

const sdkFileUrl = computed(() => {
  const configured = signing.value?.sdkUrl?.trim();
  return configured || `${trackBaseUrl.value}/sdk/track-sdk.min.js`;
});

/** 脚本标签接入：只带 appId（env 由服务端按应用记录判定），serverUrl 可选 */
const snippet = computed(() => {
  const app = secretPayload.value.app;
  if (!app) return '';
  const openTag = `<${'script'}>`;
  const closeTag = `</${'script'}>`;
  return [
    openTag,
    '(function (w, d, s) {',
    "  if (d.getElementById('track-sdk')) return;",
    '  w.__trackQueue = w.__trackQueue || [];',
    `  w.__trackQueue.push(['init', { appId: '${app.appId}' }]);`,
    '  var first = d.getElementsByTagName(s)[0];',
    '  var el = d.createElement(s);',
    "  el.id = 'track-sdk';",
    '  el.async = true;',
    `  el.src = '${sdkFileUrl.value}';`,
    '  first.parentNode.insertBefore(el, first);',
    "})(window, document, 'script');",
    closeTag,
  ].join('\n');
});

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : '请求失败';
}

async function copy(text: string, label: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    ElMessage.success(`${label}已复制`);
  } catch {
    ElMessage.warning('浏览器拒绝了剪贴板访问，请手动选择复制');
  }
}

async function loadApps(): Promise<void> {
  appsLoading.value = true;
  try {
    const data = await fetchApps();
    apps.value = data.apps;
    signing.value = data.signing;
    forbidden.value = false;
  } catch (error) {
    if (error instanceof ApiError && error.status === 403) {
      forbidden.value = true;
      return;
    }
    ElMessage.error(errorText(error));
  } finally {
    appsLoading.value = false;
  }
}

async function loadUsers(): Promise<void> {
  if (!isAdmin.value) return;
  usersLoading.value = true;
  try {
    users.value = await fetchUsers();
  } catch (error) {
    if (error instanceof ApiError && error.status === 403) return;
    ElMessage.error(errorText(error));
  } finally {
    usersLoading.value = false;
  }
}

function openCreate(): void {
  createForm.name = '';
  createForm.env = signing.value?.env ?? 'prod';
  createForm.remark = '';
  createVisible.value = true;
}

/** 同一环境下应用名不可重复（不同环境仍可同名，便于一个业务分环境接入） */
function hasDuplicateName(name: string, env: string, excludeAppId?: string): boolean {
  const key = name.trim().toLowerCase();
  return apps.value.some(
    (app) => app.appId !== excludeAppId && app.env === env && app.name.trim().toLowerCase() === key,
  );
}

async function submitCreate(): Promise<void> {
  const name = createForm.name.trim();
  if (!name) {
    ElMessage.warning('请填写应用名称');
    return;
  }
  if (hasDuplicateName(name, createForm.env)) {
    ElMessage.warning(`环境 ${createForm.env} 下已存在同名应用「${name}」，请换一个名称或环境`);
    return;
  }
  creating.value = true;
  try {
    const result = await createApp({
      name,
      env: createForm.env.trim() || undefined,
      remark: createForm.remark.trim() || undefined,
    });
    createVisible.value = false;
    secretPayload.value = { app: result.app, secret: result.secret };
    secretVisible.value = true;
    await loadApps();
  } catch (error) {
    ElMessage.error(errorText(error));
  } finally {
    creating.value = false;
  }
}

async function rotateSecret(app: AdminApp): Promise<void> {
  try {
    await ElMessageBox.confirm(
      `轮换后旧密钥立即失效，所有使用 ${app.appId} 的 SDK 必须同步更新。确定继续？`,
      '轮换密钥',
      { type: 'warning', confirmButtonText: '确定轮换', cancelButtonText: '取消' },
    );
  } catch {
    return;
  }
  try {
    const result = await rotateAppSecret(app.appId);
    secretPayload.value = { app: result.app, secret: result.secret };
    secretVisible.value = true;
    await loadApps();
  } catch (error) {
    ElMessage.error(errorText(error));
  }
}

async function toggleStatus(app: AdminApp): Promise<void> {
  const next: AppStatus = app.status === 'active' ? 'disabled' : 'active';
  const action = next === 'disabled' ? '停用' : '启用';
  try {
    await ElMessageBox.confirm(
      next === 'disabled'
        ? `停用后「${app.name}」的上报会被直接丢弃（按 unknown_app_id 处理），且不会重试。确定停用？`
        : `启用后「${app.name}」将立即恢复上报。确定启用？`,
      `${action}应用`,
      { type: 'warning', confirmButtonText: `确定${action}`, cancelButtonText: '取消' },
    );
  } catch {
    return;
  }
  try {
    await updateApp(app.appId, { status: next });
    ElMessage.success(next === 'active' ? '已启用' : '已停用，该应用的埋点将被拒绝');
    await loadApps();
  } catch (error) {
    ElMessage.error(errorText(error));
  }
}

async function removeApp(app: AdminApp): Promise<void> {
  try {
    await ElMessageBox.confirm(
      `删除后 ${app.appId} 无法再上报，历史数据保留。确定删除？`,
      '删除应用',
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' },
    );
  } catch {
    return;
  }
  try {
    await deleteApp(app.appId);
    ElMessage.success('已删除');
    await loadApps();
  } catch (error) {
    ElMessage.error(errorText(error));
  }
}

async function changeRole(user: AuthUser, role: UserRole): Promise<void> {
  try {
    await updateUser(user.id, { role });
    ElMessage.success(`${user.name} 的角色已更新`);
    await loadUsers();
    await ensureSession(true);
  } catch (error) {
    ElMessage.error(errorText(error));
    await loadUsers();
  }
}

async function changeStatus(user: AuthUser, status: 'active' | 'disabled'): Promise<void> {
  try {
    await updateUser(user.id, { status });
    ElMessage.success(status === 'active' ? '已启用该账号' : '已停用该账号');
    await loadUsers();
  } catch (error) {
    ElMessage.error(errorText(error));
    await loadUsers();
  }
}

onMounted(async () => {
  await ensureSession();
  await loadApps();
  await loadUsers();
});
</script>

<template>
  <el-result
    v-if="forbidden"
    icon="warning"
    title="需要管理员权限"
    sub-title="当前账号没有管理后台权限，请联系管理员在「成员管理」中调整角色。"
  />

  <template v-else>
    <section class="page-card">
      <div class="card-title">
        <h3>管理后台</h3>
        <span class="hint">在这里颁发应用凭据、维护成员权限</span>
      </div>

      <el-tabs v-model="activeTab">
        <el-tab-pane label="应用管理" name="apps">
          <div class="toolbar">
            <div class="signing">
              <template v-if="signing">
                <el-tag size="small" type="info">上报地址 {{ signing.trackPath }}</el-tag>
                <el-tag size="small" type="info">环境 {{ signing.env }}</el-tag>
                <el-tag size="small" :type="signing.signRequired ? 'success' : 'warning'">
                  {{ signing.signRequired ? '已开启签名校验' : '未开启签名校验' }}
                </el-tag>
                <el-tag size="small" type="info">时间窗 ±{{ Math.round(signing.signWindowSeconds / 60) }} 分钟</el-tag>
              </template>
            </div>
            <el-button type="primary" @click="openCreate">新建应用</el-button>
          </div>

          <el-table v-loading="appsLoading" :data="apps" style="width: 100%">
            <el-table-column label="应用" min-width="180">
              <template #default="{ row }">
                <div class="app-name">{{ row.name }}</div>
                <div class="mono muted">{{ row.appId }}</div>
              </template>
            </el-table-column>
            <el-table-column label="密钥" width="180">
              <template #default="{ row }">
                <span class="mono">{{ row.secretMask }}</span>
              </template>
            </el-table-column>
            <el-table-column label="环境" width="100">
              <template #default="{ row }">
                <el-tag size="small" effect="plain">{{ row.env }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="状态" width="100">
              <template #default="{ row }">
                <el-tag size="small" :type="row.status === 'active' ? 'success' : 'info'">
                  {{ row.status === 'active' ? '启用' : '已停用' }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column label="来源" width="100">
              <template #default="{ row }">
                <el-tag size="small" :type="row.source === 'db' ? 'primary' : 'warning'" effect="plain">
                  {{ row.source === 'db' ? '后台创建' : '环境变量' }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column label="创建信息" min-width="200">
              <template #default="{ row }">
                <div class="muted" style="font-size: 12px">{{ formatDateTime(row.createdAt) }}</div>
                <div class="mono muted">{{ row.createdBy ?? '—' }}</div>
              </template>
            </el-table-column>
            <el-table-column label="操作" width="264" fixed="right">
              <template #default="{ row }">
                <template v-if="row.source === 'db'">
                  <el-button link type="primary" @click="copy(row.appId, 'App ID')">复制 ID</el-button>
                  <el-button link type="primary" @click="rotateSecret(row)">轮换密钥</el-button>
                  <el-button link :type="row.status === 'active' ? 'warning' : 'success'" @click="toggleStatus(row)">
                    {{ row.status === 'active' ? '停用' : '启用' }}
                  </el-button>
                  <el-button link type="danger" @click="removeApp(row)">删除</el-button>
                </template>
                <span v-else class="muted" style="font-size: 12px">由 APP_SECRETS 维护，只读</span>
              </template>
            </el-table-column>

            <template #empty>
              <el-empty description="还没有应用，点击「新建应用」颁发第一个 appId" :image-size="72" />
            </template>
          </el-table>

          <p class="tips">
            密钥只在创建或轮换时展示一次，请立刻保存到接入方的配置中心；列表里只保留掩码。
          </p>
        </el-tab-pane>

        <el-tab-pane v-if="isAdmin" label="成员管理" name="users">
          <el-table v-loading="usersLoading" :data="users" style="width: 100%">
            <el-table-column label="成员" min-width="200">
              <template #default="{ row }">
                <div class="user-cell">
                  <el-avatar :size="28" :src="row.avatarUrl ?? undefined">
                    {{ (row.name || '?').slice(0, 1).toUpperCase() }}
                  </el-avatar>
                  <div>
                    <div>{{ row.name }}</div>
                    <div class="mono muted">{{ row.email ?? row.openId ?? row.localUsername ?? '—' }}</div>
                  </div>
                </div>
              </template>
            </el-table-column>
            <el-table-column label="来源" width="110">
              <template #default="{ row }">
                <el-tag size="small" effect="plain">{{ row.source === 'feishu' ? '飞书' : '本地' }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="角色" width="150">
              <template #default="{ row }">
                <el-select
                  :model-value="row.role"
                  size="small"
                  :disabled="row.id === currentUserId"
                  @change="(value: UserRole) => changeRole(row, value)"
                >
                  <el-option label="管理员" value="admin" />
                  <el-option label="只读" value="viewer" />
                </el-select>
              </template>
            </el-table-column>
            <el-table-column label="状态" width="110">
              <template #default="{ row }">
                <el-switch
                  :model-value="row.status === 'active'"
                  :disabled="row.id === currentUserId"
                  @change="(value: boolean) => changeStatus(row, value ? 'active' : 'disabled')"
                />
              </template>
            </el-table-column>
            <el-table-column label="最后登录" width="200">
              <template #default="{ row }">{{ formatDateTime(row.lastLoginAt) }}</template>
            </el-table-column>
            <el-table-column label="首次登录" width="200">
              <template #default="{ row }">{{ formatDateTime(row.createdAt) }}</template>
            </el-table-column>

            <template #empty>
              <el-empty description="还没有成员，飞书扫码登录后会自动建档" :image-size="72" />
            </template>
          </el-table>

          <p class="tips">
            首次登录的用户在没有任何管理员时自动成为管理员；其余用户默认只读，需在这里授予管理员权限。
          </p>
        </el-tab-pane>
      </el-tabs>
    </section>

    <el-dialog v-model="createVisible" title="新建应用" width="480px">
      <el-form label-width="88px" @submit.prevent>
        <el-form-item label="应用名称" required>
          <el-input v-model="createForm.name" maxlength="64" show-word-limit placeholder="如 Flylinking 买家端" />
        </el-form-item>
        <el-form-item label="环境">
          <el-select v-model="createForm.env" style="width: 100%" placeholder="请选择环境">
            <el-option v-for="item in ENV_OPTIONS" :key="item" :label="item" :value="item" />
          </el-select>
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="createForm.remark" type="textarea" :rows="2" maxlength="255" show-word-limit />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="createVisible = false">取消</el-button>
        <el-button type="primary" :loading="creating" @click="submitCreate">创建并生成密钥</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="secretVisible" title="应用凭据（仅显示一次）" width="560px">
      <el-alert
        type="warning"
        show-icon
        :closable="false"
        title="请立即复制保存"
        description="密钥不会再次明文展示。丢失后只能轮换，轮换会使旧密钥立即失效。"
        style="margin-bottom: 14px"
      />
      <el-form label-width="88px" @submit.prevent>
        <el-form-item label="应用名称">
          <span>{{ secretPayload.app?.name }}</span>
        </el-form-item>
        <el-form-item label="App ID">
          <div class="copy-row">
            <span class="mono">{{ secretPayload.app?.appId }}</span>
            <el-button link type="primary" @click="copy(secretPayload.app?.appId ?? '', 'App ID')">复制</el-button>
          </div>
        </el-form-item>
        <el-form-item label="Secret">
          <div class="copy-row">
            <span class="mono secret">{{ secretPayload.secret }}</span>
            <el-button link type="primary" @click="copy(secretPayload.secret, 'Secret')">复制</el-button>
          </div>
        </el-form-item>
        <el-form-item label="环境">
          <div class="copy-row">
            <el-tag size="small" effect="plain">{{ secretPayload.app?.env }}</el-tag>
            <span class="muted" style="font-size: 12px">数据入看板时按此环境隔离，接入方无需再传 env</span>
          </div>
        </el-form-item>
        <el-form-item label="接入代码">
          <div class="snippet-block">
            <pre class="properties-block snippet">{{ snippet }}</pre>
            <el-button link type="primary" @click="copy(snippet, '接入代码')">一键复制</el-button>
            <span class="muted" style="font-size: 12px">
              默认上报到本系统（{{ defaultTrackUrl }}）。如需把数据留在自己的环境，在 init 里加
              serverUrl: '你的上报地址'，本看板将收不到这批数据。
            </span>
          </div>
        </el-form-item>
        <el-alert
          v-if="signing?.signRequired"
          type="warning"
          show-icon
          :closable="false"
          style="margin: 0 0 14px"
          title="服务端已开启签名校验"
          description="脚本标签接入不带签名密钥，上报会被丢弃。请关闭 SIGN_REQUIRED，或改用带 signSecret 的初始化方式。"
        />
        <el-form-item label="凭据备份">
          <pre class="properties-block" style="width: 100%; margin: 0">{{
            JSON.stringify(
              { appId: secretPayload.app?.appId, secret: secretPayload.secret, env: secretPayload.app?.env },
              null,
              2,
            )
          }}</pre>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button type="primary" @click="secretVisible = false">我已保存</el-button>
      </template>
    </el-dialog>
  </template>
</template>

<style scoped>
.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
  flex-wrap: wrap;
}

.signing {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.app-name {
  font-weight: 600;
  margin-bottom: 2px;
}

.user-cell {
  display: flex;
  align-items: center;
  gap: 10px;
}

.copy-row {
  display: flex;
  align-items: center;
  gap: 8px;
  word-break: break-all;
}

.secret {
  color: #c0341d;
}

.snippet-block {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
  width: 100%;
}

.snippet {
  width: 100%;
  margin: 0;
  max-height: 220px;
  overflow: auto;
  font-size: 12px;
  line-height: 1.5;
}

.tips {
  color: var(--text-muted);
  font-size: 12px;
  margin: 12px 0 0;
}
</style>
