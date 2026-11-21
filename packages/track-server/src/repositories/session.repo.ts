import type { DbPool } from '../lib/db.js';
import type { SessionRecord, SessionStore } from './ports.js';

export class MysqlSessionStore implements SessionStore {
  constructor(private readonly db: DbPool) {}

  async create(record: SessionRecord, now: Date): Promise<void> {
    await this.db.query(
      `INSERT INTO admin_sessions (token_hash, user_id, expires_at, created_at, ip, user_agent)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [record.tokenHash, record.userId, record.expiresAt, now, record.ip, record.userAgent],
    );
  }

  async findUserIdByTokenHash(tokenHash: string, now: Date): Promise<number | null> {
    const rows = await this.db.query<{ userId: number }>(
      'SELECT user_id AS userId FROM admin_sessions WHERE token_hash = ? AND expires_at > ? LIMIT 1',
      [tokenHash, now],
    );
    const row = rows[0];
    return row ? Number(row.userId) : null;
  }

  async deleteByTokenHash(tokenHash: string): Promise<void> {
    await this.db.query('DELETE FROM admin_sessions WHERE token_hash = ?', [tokenHash]);
  }

  async deleteExpired(now: Date): Promise<void> {
    await this.db.query('DELETE FROM admin_sessions WHERE expires_at <= ?', [now]);
  }
}
