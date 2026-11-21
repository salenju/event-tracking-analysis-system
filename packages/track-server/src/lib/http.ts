import { BadRequestError } from '../domain/errors.js';

export type QueryRecord = Record<string, unknown>;

export function readString(source: QueryRecord, key: string): string | undefined {
  const value = source[key];
  if (typeof value === 'string') return value.trim() || undefined;
  if (Array.isArray(value)) {
    const found = value.find((item): item is string => typeof item === 'string');
    return found?.trim() || undefined;
  }
  return undefined;
}

export function readBooleanish(source: QueryRecord, key: string): boolean | undefined {
  const raw = readString(source, key);
  if (raw === undefined) return undefined;
  if (raw === 'true' || raw === '1') return true;
  if (raw === 'false' || raw === '0') return false;
  throw new BadRequestError(`${key} must be true/false`);
}

export function readInt(
  source: QueryRecord,
  key: string,
  options: { fallback: number; min?: number; max?: number },
): number {
  const raw = readString(source, key);
  if (raw === undefined) return options.fallback;
  const value = Number(raw);
  if (!Number.isInteger(value)) throw new BadRequestError(`${key} must be an integer`);
  if (options.min !== undefined && value < options.min) {
    throw new BadRequestError(`${key} must be >= ${options.min}`);
  }
  if (options.max !== undefined && value > options.max) {
    throw new BadRequestError(`${key} must be <= ${options.max}`);
  }
  return value;
}

/**
 * 读取 JSON 请求体。
 * 注意 registerRawBody 把所有 content-type 都按字符串接收（为了埋点接口拿到原始 body），
 * 所以管理接口的 application/json 也会是字符串，必须在这里统一 parse。
 */
export function readJsonBody(body: unknown): Record<string, unknown> {
  if (body && typeof body === 'object') return body as Record<string, unknown>;
  if (typeof body === 'string') {
    const text = body.trim();
    if (!text) return {};
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new BadRequestError('request body must be valid JSON');
    }
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    throw new BadRequestError('request body must be a JSON object');
  }
  return {};
}

export function readStringList(source: QueryRecord, key: string): string[] | undefined {
  const raw = source[key];
  if (raw === undefined) return undefined;
  const values = Array.isArray(raw) ? raw : String(raw).split(',');
  const result = values
    .map((item) => String(item).trim())
    .filter((item) => item.length > 0);
  return result.length > 0 ? result : undefined;
}
