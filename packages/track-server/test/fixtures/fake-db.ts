import type { Db, DbConnection, DbPool } from '../../src/lib/db.js';

export interface RecordedBatch {
  batchId: string;
  appId: string;
  env: string;
  recordCount: number;
  receivedAt: Date;
  ip?: string | null;
  country?: string | null;
  region?: string | null;
  ua?: string | null;
  deviceType?: string | null;
  os?: string | null;
  browser?: string | null;
  urlPath?: string | null;
  referrer?: string | null;
  lang?: string | null;
}

export interface RecordedEventRow {
  batchId: string;
  appId: string;
  env: string;
  country: string | null;
  deviceType: string | null;
  urlPath: string | null;
  recordType: string;
  event: string | null;
  userId: string | null;
  sessionId: string;
  orderId: string | null;
  walletType: string | null;
  failReason: string | null;
  properties: string | null;
  occurredAt: Date;
  receivedAt: Date;
}

const EVENT_COLUMNS = 16;
const BATCH_COLUMNS = 15;

/** 内存假库：用于验证路由契约，不需要真实 MySQL */
export class FakeDb implements Db {
  readonly batches: RecordedBatch[] = [];
  readonly events: RecordedEventRow[] = [];
  failOnInsertEvents = false;
  ingest: DbPool;
  query: DbPool;

  constructor() {
    this.ingest = this.createPool();
    this.query = this.createPool();
  }

  private createPool(): DbPool {
    const owner = this;
    return {
      async query<T = unknown>(): Promise<T[]> {
        return [];
      },
      async getConnection(): Promise<DbConnection> {
        const connection: DbConnection = {
          async query<T = unknown>(sql: string, params: readonly unknown[] = []): Promise<T[]> {
            if (sql.includes('INSERT INTO event_batches')) {
              const chunk = params.slice(0, BATCH_COLUMNS);
              const batchId = String(chunk[0]);
              if (owner.batches.some((item) => item.batchId === batchId)) {
                const error = new Error('Duplicate entry') as Error & { code?: string; errno?: number };
                error.code = 'ER_DUP_ENTRY';
                error.errno = 1062;
                throw error;
              }
              owner.batches.push({
                batchId,
                appId: String(chunk[1]),
                env: String(chunk[2]),
                recordCount: Number(chunk[3]),
                receivedAt: chunk[4] as Date,
                ip: (chunk[5] as string | null) ?? null,
                country: (chunk[6] as string | null) ?? null,
                region: (chunk[7] as string | null) ?? null,
                ua: (chunk[8] as string | null) ?? null,
                deviceType: (chunk[9] as string | null) ?? null,
                os: (chunk[10] as string | null) ?? null,
                browser: (chunk[11] as string | null) ?? null,
                urlPath: (chunk[12] as string | null) ?? null,
                referrer: (chunk[13] as string | null) ?? null,
                lang: (chunk[14] as string | null) ?? null,
              });
              return [];
            }
            if (sql.includes('INSERT INTO events')) {
              if (owner.failOnInsertEvents) throw new Error('db is down');
              for (let index = 0; index < params.length; index += EVENT_COLUMNS) {
                const chunk = params.slice(index, index + EVENT_COLUMNS);
                owner.events.push({
                  batchId: String(chunk[0]),
                  appId: String(chunk[1]),
                  env: String(chunk[2]),
                  country: (chunk[3] as string | null) ?? null,
                  deviceType: (chunk[4] as string | null) ?? null,
                  urlPath: (chunk[5] as string | null) ?? null,
                  recordType: String(chunk[6]),
                  event: (chunk[7] as string | null) ?? null,
                  userId: (chunk[8] as string | null) ?? null,
                  sessionId: String(chunk[9]),
                  orderId: (chunk[10] as string | null) ?? null,
                  walletType: (chunk[11] as string | null) ?? null,
                  failReason: (chunk[12] as string | null) ?? null,
                  properties: (chunk[13] as string | null) ?? null,
                  occurredAt: chunk[14] as Date,
                  receivedAt: chunk[15] as Date,
                });
              }
              return [];
            }
            return [];
          },
          async beginTransaction(): Promise<void> {
            return undefined;
          },
          async commit(): Promise<void> {
            return undefined;
          },
          async rollback(): Promise<void> {
            return undefined;
          },
          release(): void {
            return undefined;
          },
        };
        return connection;
      },
      async close(): Promise<void> {
        return undefined;
      },
    };
  }
}
