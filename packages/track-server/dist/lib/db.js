import mysql from 'mysql2/promise';
function toRows(rows) {
    return Array.isArray(rows) ? rows : [];
}
function wrap(connection) {
    return {
        async query(sql, params = []) {
            const [rows] = await connection.query(sql, params);
            return toRows(rows);
        },
        beginTransaction: () => connection.beginTransaction(),
        commit: () => connection.commit(),
        rollback: () => connection.rollback(),
        release: () => connection.release(),
    };
}
function wrapPool(pool) {
    return {
        async query(sql, params = []) {
            const [rows] = await pool.query(sql, params);
            return toRows(rows);
        },
        async affected(sql, params = []) {
            const [result] = await pool.query(sql, params);
            return Number(result?.affectedRows ?? 0);
        },
        async getConnection() {
            const connection = await pool.getConnection();
            return wrap(connection);
        },
        close: async () => {
            await pool.end();
        },
    };
}
function createPool(config, connectionLimit) {
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
export function createDb(config) {
    const ingestPool = createPool(config, config.poolIngest);
    const queryPool = createPool(config, config.poolQuery);
    return {
        ingest: wrapPool(ingestPool),
        query: wrapPool(queryPool),
    };
}
export async function closeDb(db) {
    await Promise.allSettled([db.ingest.close(), db.query.close()]);
}
//# sourceMappingURL=db.js.map