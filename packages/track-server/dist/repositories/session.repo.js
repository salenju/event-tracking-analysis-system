export class MysqlSessionStore {
    db;
    constructor(db) {
        this.db = db;
    }
    async create(record, now) {
        await this.db.query(`INSERT INTO admin_sessions (token_hash, user_id, expires_at, created_at, ip, user_agent)
       VALUES (?, ?, ?, ?, ?, ?)`, [record.tokenHash, record.userId, record.expiresAt, now, record.ip, record.userAgent]);
    }
    async findUserIdByTokenHash(tokenHash, now) {
        const rows = await this.db.query('SELECT user_id AS userId FROM admin_sessions WHERE token_hash = ? AND expires_at > ? LIMIT 1', [tokenHash, now]);
        const row = rows[0];
        return row ? Number(row.userId) : null;
    }
    async deleteByTokenHash(tokenHash) {
        await this.db.query('DELETE FROM admin_sessions WHERE token_hash = ?', [tokenHash]);
    }
    async deleteExpired(now) {
        await this.db.query('DELETE FROM admin_sessions WHERE expires_at <= ?', [now]);
    }
}
//# sourceMappingURL=session.repo.js.map