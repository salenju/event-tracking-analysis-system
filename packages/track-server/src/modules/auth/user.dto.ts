import type { AdminUser, UserRole, UserSource, UserStatus } from '../../domain/auth.js';

export interface PublicUser {
  id: number;
  name: string;
  avatarUrl: string | null;
  email: string | null;
  role: UserRole;
  status: UserStatus;
  source: UserSource;
  localUsername: string | null;
  openId: string | null;
  createdAt: string;
  lastLoginAt: string | null;
}

/** 对外输出：不含任何密钥，只保留界面需要的字段 */
export function toPublicUser(user: AdminUser): PublicUser {
  return {
    id: user.id,
    name: user.name,
    avatarUrl: user.avatarUrl,
    email: user.email,
    role: user.role,
    status: user.status,
    source: user.source,
    localUsername: user.localUsername,
    openId: user.openId,
    createdAt: user.createdAt.toISOString(),
    lastLoginAt: user.lastLoginAt ? user.lastLoginAt.toISOString() : null,
  };
}
