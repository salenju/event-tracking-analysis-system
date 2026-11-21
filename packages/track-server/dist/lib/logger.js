export function loggerOptions(config) {
    if (config.nodeEnv === 'production') {
        return { level: config.logLevel };
    }
    return {
        level: config.logLevel,
        transport: {
            target: 'pino-pretty',
            options: { translateTime: 'SYS:standard', ignore: 'pid,hostname' },
        },
    };
}
export const silentLogger = {
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    debug: () => undefined,
};
//# sourceMappingURL=logger.js.map