import type { AnalyticsApp, AppStatus } from '../domain/auth.js';
import type { DbPool } from '../lib/db.js';
import type { AppStore, AppUpdatePatch } from './ports.js';

const SELECT_COLUMNS = `
  app_id AS appId, name, secret, env, status, remark, created_by AS createdBy,
  created_at AS createdAt, updated_at AS updatedAt
`;

interface Row {
  appId: string;
  name: string;
  secret: string;
  env: string;
  status: AppStatus;
  remark: string | null;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

function toApp(row: Row): AnalyticsApp {
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

export class MysqlAppStore implements AppStore {
  constructor(private readonly db: DbPool) {}

  async list(): Promise<AnalyticsApp[]> {
    const rows = await this.db.query<Row>(`SELECT ${SELECT_COLUMNS} FROM analytics_apps ORDER BY created_at DESC`);
    return rows.map(toApp);
  }

  async find(appId: string): Promise<AnalyticsApp | null> {
    const rows = await this.db.query<Row>(`SELECT ${SELECT_COLUMNS} FROM analytics_apps WHERE app_id = ? LIMIT 1`, [
      appId,
    ]);
    return rows[0] ? toApp(rows[0]) : null;
  }

  async insert(app: AnalyticsApp): Promise<void> {
    await this.db.query(
      `INSERT INTO analytics_apps (app_id, name, secret, env, status, remark, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [app.appId, app.name, app.secret, app.env, app.status, app.remark, app.createdBy, app.createdAt, app.updatedAt],
    );
  }

  async update(appId: string, patch: AppUpdatePatch, now: Date): Promise<void> {
    const sets: string[] = [];
    const params: unknown[] = [];
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
    if (sets.length === 0) return;
    sets.push('updated_at = ?');
    params.push(now, appId);
    await this.db.query(`UPDATE analytics_apps SET ${sets.join(', ')} WHERE app_id = ?`, params);
  }

  async updateSecret(appId: string, secret: string, now: Date): Promise<void> {
    await this.db.query('UPDATE analytics_apps SET secret = ?, updated_at = ? WHERE app_id = ?', [secret, now, appId]);
  }

  async remove(appId: string): Promise<void> {
    await this.db.query('DELETE FROM analytics_apps WHERE app_id = ?', [appId]);
  }
}
