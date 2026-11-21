import { z } from 'zod';
const dataSchema = z
    .union([z.record(z.unknown()), z.null(), z.undefined()])
    .transform((value) => (value ?? {}));
/** 单条记录：type 不止 event（performance / page_stay / error 同队列发送） */
export const recordSchema = z.object({
    type: z.string().min(1).max(32),
    timestamp: z.number().int().positive(),
    data: dataSchema,
});
/**
 * 批次信封：batch 用 unknown[] 接收，逐条单独校验。
 * 若在信封层就校验记录，一条脏数据会让整批失败，连带丢失同批关键事件。
 */
export const envelopeSchema = z.object({
    appId: z.string().min(1).max(64),
    sdkVersion: z.string().max(32).optional(),
    userId: z.string().nullish(),
    sessionId: z.string().min(1).max(64),
    batchId: z.string().min(1).max(64),
    sentAt: z.number().int().positive(),
    env: z.string().max(16).optional(),
    context: z
        .union([z.record(z.unknown()), z.null(), z.undefined()])
        .transform((value) => (value ?? {})),
    batch: z.array(z.unknown()).min(1),
});
//# sourceMappingURL=payload.schema.js.map