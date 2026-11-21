/** 对外输出：不含任何密钥，只保留界面需要的字段 */
export function toPublicUser(user) {
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
//# sourceMappingURL=user.dto.js.map