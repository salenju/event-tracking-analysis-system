export type UserRole = 'admin' | 'viewer';
export type UserStatus = 'active' | 'disabled';
export type UserSource = 'feishu' | 'local';
export type AppStatus = 'active' | 'disabled';

/** 看板用户：来自飞书登录，或本地调试登录 */
export interface AdminUser {
  id: number;
  openId: string | null;
  unionId: string | null;
  feishuUserId: string | null;
  name: string;
  avatarUrl: string | null;
  email: string | null;
  role: UserRole;
  status: UserStatus;
  source: UserSource;
  localUsername: string | null;
  createdAt: Date;
  lastLoginAt: Date | null;
}

/** 飞书 user_info 归一化后的字段 */
export interface FeishuProfile {
  openId: string;
  unionId: string | null;
  userId: string | null;
  name: string;
  avatarUrl: string | null;
  email: string | null;
}

/** 埋点应用凭据 */
export interface AnalyticsApp {
  appId: string;
  name: string;
  /** 明文密钥，仅内部使用；对外的列表接口只返回掩码 */
  secret: string;
  env: string;
  status: AppStatus;
  remark: string | null;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
  /** db：管理后台创建；env：来自 APP_SECRETS，只读 */
  source: 'db' | 'env';
}
