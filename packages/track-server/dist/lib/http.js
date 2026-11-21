import { BadRequestError } from '../domain/errors.js';
export function readString(source, key) {
    const value = source[key];
    if (typeof value === 'string')
        return value.trim() || undefined;
    if (Array.isArray(value)) {
        const found = value.find((item) => typeof item === 'string');
        return found?.trim() || undefined;
    }
    return undefined;
}
export function readBooleanish(source, key) {
    const raw = readString(source, key);
    if (raw === undefined)
        return undefined;
    if (raw === 'true' || raw === '1')
        return true;
    if (raw === 'false' || raw === '0')
        return false;
    throw new BadRequestError(`${key} must be true/false`);
}
export function readInt(source, key, options) {
    const raw = readString(source, key);
    if (raw === undefined)
        return options.fallback;
    const value = Number(raw);
    if (!Number.isInteger(value))
        throw new BadRequestError(`${key} must be an integer`);
    if (options.min !== undefined && value < options.min) {
        throw new BadRequestError(`${key} must be >= ${options.min}`);
    }
    if (options.max !== undefined && value > options.max) {
        throw new BadRequestError(`${key} must be <= ${options.max}`);
    }
    return value;
}
export function readStringList(source, key) {
    const raw = source[key];
    if (raw === undefined)
        return undefined;
    const values = Array.isArray(raw) ? raw : String(raw).split(',');
    const result = values
        .map((item) => String(item).trim())
        .filter((item) => item.length > 0);
    return result.length > 0 ? result : undefined;
}
//# sourceMappingURL=http.js.map