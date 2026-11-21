export class MysqlLoginStateStore {
    db;
    constructor(db) {
        this.db = db;
    }
    async create(state, mode, expiresAt, now) {
        await this.db.query('INSERT INTO auth_login_states (state, mode, expires_at, created_at) VALUES (?, ?, ?, ?)', [state, mode, expiresAt, now]);
    }
    /**
     * 先查后删：DELETE 的影响行数决定「本次是否消费成功」，
     * 并发回调时只有一个请求能删到行，其余返回 null，天然防重放。
     */
    async consume(state, now) {
        const rows = await this.db.query('SELECT mode FROM auth_login_states WHERE state = ? AND expires_at > ? LIMIT 1', [state, now]);
        const row = rows[0];
        if (!row)
            return null;
        const affected = await this.db.affected('DELETE FROM auth_login_states WHERE state = ? AND expires_at > ?', [
            state,
            now,
        ]);
        return affected > 0 ? { mode: row.mode } : null;
    }
    async deleteExpired(now) {
        await this.db.query('DELETE FROM auth_login_states WHERE expires_at <= ?', [now]);
    }
}
//# sourceMappingURL=login-state.repo.js.map