const SELECT_COLUMNS = `
  app_id AS appId, name, secret, env, status, remark, created_by AS createdBy,
  created_at AS createdAt, updated_at AS updatedAt
`;
function toApp(row) {
    return {
        appId: row.appId,
        name: row.name,
        secret: row.secret,
        env: row.env,
        status: row.status,
        remark: row.remark ?? null,
        createdBy: row.createdBy ?? null,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        source: 'db',
    };
}
export class MysqlAppStore {
    db;
    constructor(db) {
        this.db = db;
    }
    async list() {
        const rows = await this.db.query(`SELECT ${SELECT_COLUMNS} FROM analytics_apps ORDER BY created_at DESC`);
        return rows.map(toApp);
    }
    async find(appId) {
        const rows = await this.db.query(`SELECT ${SELECT_COLUMNS} FROM analytics_apps WHERE app_id = ? LIMIT 1`, [
            appId,
        ]);
        return rows[0] ? toApp(rows[0]) : null;
    }
    async insert(app) {
        await this.db.query(`INSERT INTO analytics_apps (app_id, name, secret, env, status, remark, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, [app.appId, app.name, app.secret, app.env, app.status, app.remark, app.createdBy, app.createdAt, app.updatedAt]);
    }
    async update(appId, patch, now) {
        const sets = [];
        const params = [];
        if (patch.name !== undefined) {
            sets.push('name = ?');
            params.push(patch.name);
        }
        if (patch.env !== undefined) {
            sets.push('env = ?');
            params.push(patch.env);
        }
        if (patch.status !== undefined) {
            sets.push('status = ?');
            params.push(patch.status);
        }
        if (patch.remark !== undefined) {
            sets.push('remark = ?');
            params.push(patch.remark);
        }
        if (sets.length === 0)
            return;
        sets.push('updated_at = ?');
        params.push(now, appId);
        await this.db.query(`UPDATE analytics_apps SET ${sets.join(', ')} WHERE app_id = ?`, params);
    }
    async updateSecret(appId, secret, now) {
        await this.db.query('UPDATE analytics_apps SET secret = ?, updated_at = ? WHERE app_id = ?', [secret, now, appId]);
    }
    async remove(appId) {
        await this.db.query('DELETE FROM analytics_apps WHERE app_id = ?', [appId]);
    }
}
//# sourceMappingURL=app.repo.js.map