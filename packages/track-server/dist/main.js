import { buildApp } from './app.js';
import { loadConfig } from './config/index.js';
import { closeDb, createDb } from './lib/db.js';
import { loadFunnels } from './modules/funnel/funnel.config.js';
async function main() {
    const config = loadConfig();
    const funnels = loadFunnels(config.funnelsPath);
    const db = createDb(config.db);
    const app = await buildApp({ config, db, funnels });
    let shuttingDown = false;
    const shutdown = async (signal) => {
        if (shuttingDown)
            return;
        shuttingDown = true;
        app.log.info({ signal }, 'shutting down');
        try {
            await app.close();
        }
        finally {
            await closeDb(db);
        }
        process.exit(0);
    };
    process.on('SIGTERM', () => void shutdown('SIGTERM'));
    process.on('SIGINT', () => void shutdown('SIGINT'));
    try {
        await app.listen({ host: config.host, port: config.port });
        app.log.info({ mode: config.startMode, port: config.port, funnels: funnels.map((item) => item.key) }, 'track-server started');
    }
    catch (error) {
        app.log.error({ err: error }, 'failed to start');
        await closeDb(db);
        process.exit(1);
    }
}
void main();
//# sourceMappingURL=main.js.map