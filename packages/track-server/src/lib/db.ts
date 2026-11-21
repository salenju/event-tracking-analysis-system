import mysql from 'mysql2/promise';
import type { DbConfig } from '../config/index.js';

/**
 * 抽象出最小 DB 接口，便于用假实现做集成测试（不连真库）。
 */
export interface DbConnection {
  query<T = unknown>(sql: string, params?: readonly unknown[]): Promise<T[]>;
  beginTransaction(): Promise<void>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
  release(): void;
}

export interface DbPool {
  query<T = unknown>(sql: string, params?: readonly unknown[]): Promise<T[]>;
  getConnection(): Promise<DbConnection>;
  close(): Promise<void>;
}

export interface Db {
  /** 埋点写入专用池，与查询池隔离 */
  ingest: DbPool;
  query: DbPool;
}

function toRows(rows: unknown): unknown[] {
  return Array.isArray(rows) ? rows : [];
}

function wrap(connection: mysql.PoolConnection): DbConnection {
  return {
    async query<T = unknown>(sql: string, params: readonly unknown[] = []): Promise<T[]> {
      const [rows] = await connection.query(sql, params as unknown[]);
      return toRows(rows) as T[];
    },
    beginTransaction: () => connection.beginTransaction(),
    commit: () => connection.commit(),
    rollback: () => connection.rollback(),
    release: () => connection.release(),
  };
}

function wrapPool(pool: mysql.Pool): DbPool {
  return {
    async query<T = unknown>(sql: string, params: readonly unknown[] = []): Promise<T[]> {
      const [rows] = await pool.query(sql, params as unknown[]);
      return toRows(rows) as T[];
    },
    async getConnection(): Promise<DbConnection> {
      const connection = await pool.getConnection();
      return wrap(connection);
    },
    close: async () => {
      await pool.end();
    },
  };
}

function createPool(config: DbConfig, connectionLimit: number): mysql.Pool {
  return mysql.createPool({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: config.database,
    connectionLimit,
    waitForConnections: true,
    queueLimit: 0,
    connectTimeout: 5000,
    charset: 'utf8mb4_unicode_ci',
    // 全部 DATETIME 按 UTC 读写，避免容器时区不同导致偏移
    timezone: 'Z',
    supportBigNumbers: true,
    bigNumberStrings: false,
    decimalNumbers: true,
    enableKeepAlive: true,
    keepAliveInitialDelay: 10000,
    rowsAsArray: false,
  });
}

export function createDb(config: DbConfig): Db {
  const ingestPool = createPool(config, config.poolIngest);
  const queryPool = createPool(config, config.poolQuery);
  return {
    ingest: wrapPool(ingestPool),
    query: wrapPool(queryPool),
  };
}

export async function closeDb(db: Db): Promise<void> {
  await Promise.allSettled([db.ingest.close(), db.query.close()]);
}
