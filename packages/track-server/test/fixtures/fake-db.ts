import type { Db, DbConnection, DbPool } from '../../src/lib/db.js';

export interface RecordedBatch {
  batchId: string;
  appId: string;
  env: string;
  recordCount: number;
  receivedAt: Date;
}

export interface RecordedEventRow {
  batchId: string;
  appId: string;
  env: string;
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

const EVENT_COLUMNS = 13;

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
              const batchId = String(params[0]);
              if (owner.batches.some((item) => item.batchId === batchId)) {
                const error = new Error('Duplicate entry') as Error & { code?: string; errno?: number };
                error.code = 'ER_DUP_ENTRY';
                error.errno = 1062;
                throw error;
              }
              owner.batches.push({
                batchId,
                appId: String(params[1]),
                env: String(params[2]),
                recordCount: Number(params[3]),
                receivedAt: params[4] as Date,
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
                  recordType: String(chunk[3]),
                  event: (chunk[4] as string | null) ?? null,
                  userId: (chunk[5] as string | null) ?? null,
                  sessionId: String(chunk[6]),
                  orderId: (chunk[7] as string | null) ?? null,
                  walletType: (chunk[8] as string | null) ?? null,
                  failReason: (chunk[9] as string | null) ?? null,
                  properties: (chunk[10] as string | null) ?? null,
                  occurredAt: chunk[11] as Date,
                  receivedAt: chunk[12] as Date,
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
