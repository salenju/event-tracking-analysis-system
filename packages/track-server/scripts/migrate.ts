// 迁移脚本独立运行，不经过 src/config，需要自己加载 .env
import 'dotenv/config';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';

const MIGRATIONS_DIR = fileURLToPath(new URL('../migrations/', import.meta.url));

interface MigrationRow {
  version: string;
}

async function main(): Promise<void> {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST ?? '127.0.0.1',
    port: Number(process.env.DB_PORT ?? 3306),
    user: process.env.DB_USER ?? 'root',
    password: process.env.DB_PASSWORD ?? '',
    database: process.env.DB_NAME ?? 'event_tracking',
    // 迁移脚本一个文件里可能有多条语句
    multipleStatements: true,
    timezone: 'Z',
  });

  try {
    await connection.query(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
         version    VARCHAR(64) NOT NULL PRIMARY KEY,
         applied_at DATETIME(3) NOT NULL
       ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    );

    const [rows] = await connection.query('SELECT version FROM schema_migrations');
    const applied = new Set((rows as MigrationRow[]).map((row) => row.version));

    const files = readdirSync(MIGRATIONS_DIR)
      .filter((file) => file.endsWith('.up.sql'))
      .sort();

    for (const file of files) {
      const version = file.replace(/\.up\.sql$/, '');
      if (applied.has(version)) {
        console.log(`skip ${version} (already applied)`);
        continue;
      }
      const sql = readFileSync(`${MIGRATIONS_DIR}${file}`, 'utf8');
      console.log(`apply ${version}`);
      // 注意：MySQL 的 DDL 会隐式提交，无法真正回滚，只能在成功后记录版本号
      await connection.query(sql);
      await connection.query('INSERT INTO schema_migrations (version, applied_at) VALUES (?, UTC_TIMESTAMP(3))', [
        version,
      ]);
    }

    console.log('migrations completed');
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  console.error('migration failed:', error);
  process.exit(1);
});
