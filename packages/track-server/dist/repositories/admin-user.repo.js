import { isDuplicateKeyError } from '../domain/errors.js';
const SELECT_COLUMNS = `
  id, feishu_open_id AS openId, feishu_union_id AS unionId, feishu_user_id AS feishuUserId,
  name, avatar_url AS avatarUrl, email, role, status, source, local_username AS localUsername,
  created_at AS createdAt, last_login_at AS lastLoginAt
`;
function toUser(row) {
    return {
        id: Number(row.id),
        openId: row.openId ?? null,
        unionId: row.unionId ?? null,
        feishuUserId: row.feishuUserId ?? null,
        name: row.name,
        avatarUrl: row.avatarUrl ?? null,
        email: row.email ?? null,
        role: row.role,
        status: row.status,
        source: row.source,
        localUsername: row.localUsername ?? null,
        createdAt: row.createdAt,
        lastLoginAt: row.lastLoginAt ?? null,
    };
}
export class MysqlAdminUserStore {
    db;
    constructor(db) {
        this.db = db;
    }
    async findById(id) {
        const rows = await this.db.query(`SELECT ${SELECT_COLUMNS} FROM admin_users WHERE id = ? LIMIT 1`, [id]);
        return rows[0] ? toUser(rows[0]) : null;
    }
    async findByOpenId(openId) {
        const rows = await this.db.query(`SELECT ${SELECT_COLUMNS} FROM admin_users WHERE feishu_open_id = ? LIMIT 1`, [openId]);
        return rows[0] ? toUser(rows[0]) : null;
    }
    async findByLocalUsername(username) {
        const rows = await this.db.query(`SELECT ${SELECT_COLUMNS} FROM admin_users WHERE local_username = ? LIMIT 1`, [username]);
        return rows[0] ? toUser(rows[0]) : null;
    }
    async list() {
        const rows = await this.db.query(`SELECT ${SELECT_COLUMNS} FROM admin_users ORDER BY id ASC`);
        return rows.map(toUser);
    }
    async countActiveAdmins() {
        const rows = await this.db.query("SELECT COUNT(*) AS total FROM admin_users WHERE role = 'admin' AND status = 'active'");
        return Number(rows[0]?.total ?? 0);
    }
    async upsertFeishuUser(profile, role, now) {
        const existing = await this.findByOpenId(profile.openId);
        if (existing) {
            await this.db.query(`UPDATE admin_users
            SET name = ?, avatar_url = ?, email = ?, feishu_union_id = ?, feishu_user_id = ?, updated_at = ?
          WHERE id = ?`, [profile.name, profile.avatarUrl, profile.email, profile.unionId, profile.userId, now, existing.id]);
            return { ...existing, name: profile.name, avatarUrl: profile.avatarUrl, email: profile.email };
        }
        try {
            await this.db.query(`INSERT INTO admin_users
           (feishu_open_id, feishu_union_id, feishu_user_id, name, avatar_url, email, role, status, source,
            created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'active', 'feishu', ?, ?)`, [profile.openId, profile.unionId, profile.userId, profile.name, profile.avatarUrl, profile.email, role, now, now]);
        }
        catch (error) {
            // 并发首次登录：唯一键冲突时直接复用已落库的那条
            if (!isDuplicateKeyError(error))
                throw error;
        }
        const created = await this.findByOpenId(profile.openId);
        if (!created)
            throw new Error(`failed to persist feishu user ${profile.openId}`);
        return created;
    }
    async createLocalUser(username, role, now) {
        await this.db.query(`INSERT INTO admin_users (name, role, status, source, local_username, created_at, updated_at)
       VALUES (?, ?, 'active', 'local', ?, ?, ?)`, [username, role, username, now, now]);
        const created = await this.findByLocalUsername(username);
        if (!created)
            throw new Error(`failed to persist local user ${username}`);
        return created;
    }
    async updateRole(id, role, now) {
        await this.db.query('UPDATE admin_users SET role = ?, updated_at = ? WHERE id = ?', [role, now, id]);
    }
    async updateStatus(id, status, now) {
        await this.db.query('UPDATE admin_users SET status = ?, updated_at = ? WHERE id = ?', [status, now, id]);
    }
    async touchLogin(id, now) {
        await this.db.query('UPDATE admin_users SET last_login_at = ?, updated_at = ? WHERE id = ?', [now, now, id]);
    }
}
//# sourceMappingURL=admin-user.repo.js.map