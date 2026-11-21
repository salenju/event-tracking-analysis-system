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

async function submitCreate(): Promise<void> {
  if (!createForm.name.trim()) {
    ElMessage.warning('请填写应用名称');
    return;
  }
  creating.value = true;
  try {
    const result = await createApp({
      name: createForm.name.trim(),
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
        <el-form-item label="默认环境">
          <el-input v-model="createForm.env" maxlength="16" placeholder="prod / test" />
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
        <el-form-item label="接入配置">
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

.tips {
  color: var(--text-muted);
  font-size: 12px;
  margin: 12px 0 0;
}
</style>
