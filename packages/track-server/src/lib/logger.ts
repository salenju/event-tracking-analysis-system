import type { FastifyServerOptions } from 'fastify';
import type { AppConfig } from '../config/index.js';

/** 供 service 层使用的最小日志接口，避免把 Fastify 类型带进业务 */
export interface Logger {
  info(obj: unknown, msg?: string): void;
  warn(obj: unknown, msg?: string): void;
  error(obj: unknown, msg?: string): void;
  debug(obj: unknown, msg?: string): void;
}

export function loggerOptions(config: AppConfig): FastifyServerOptions['logger'] {
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

export const silentLogger: Logger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined,
};
