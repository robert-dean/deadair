import { z } from 'zod';
import { DateTime } from 'luxon';

const _ZodDatetime = z.preprocess(
    val => (typeof val === 'string' ? DateTime.fromISO(val) : val),
    z.custom<DateTime>(val => val instanceof DateTime && val.isValid, { message: 'Must be in ISO 8601 format' }),
);

/**
 * Something the station makes rather than something it says: several beats of speech, written in several passes, that airs as one block
 * generated from [Production](file://./../../../../data/contracts/productions/productions.types.ck#L8)
 */
export const Production = z.strictObject({
    id: z.string().min(1).max(100),
    kind: z
        .string()
        .min(1)
        .max(100)
        .describe('What sort of production: podcast, bulletin, feature. Free text, so a station that wants a documentary strand needs no migration'),
    title: z.string().min(1).max(300),
    brief: z
        .string()
        .max(4000)
        .optional()
        .describe("What was asked for, in the operator's own words. Distinct from the title, which is only a label"),
    personaId: z.string().max(100).optional().describe("Who presents it. Absent falls back to the station's active persona when a pass runs"),
    writingMode: z.enum(['quick', 'outlined', 'polished']).describe('How many passes to spend on it'),
    targetMs: z.coerce
        .number()
        .int()
        .min(1000)
        .describe('How long it should run. What the beat count and the per-beat word budgets are computed from'),
    state: z.enum(['planned', 'outlining', 'drafting', 'checking', 'rendering', 'ready', 'aired', 'failed', 'cancelled']),
    error: z.string().max(2000).optional().describe('Why making it did not work'),
    scheduledFor: _ZodDatetime.optional().describe('When it should air. Absent means as soon as it is made'),
    cancelledAt: _ZodDatetime.optional(),
    beats: z.coerce.number().int().min(0).describe('How many beats exist so far, which is how far along the drafting is'),
    createdAt: _ZodDatetime,
});
export type Production = z.infer<typeof Production>;

export const ProductionInput = z.strictObject({
    kind: z
        .string()
        .min(1)
        .max(100)
        .describe('What sort of production: podcast, bulletin, feature. Free text, so a station that wants a documentary strand needs no migration'),
    title: z.string().min(1).max(300),
    brief: z
        .string()
        .max(4000)
        .optional()
        .describe("What was asked for, in the operator's own words. Distinct from the title, which is only a label"),
    personaId: z.string().max(100).optional().describe("Who presents it. Absent falls back to the station's active persona when a pass runs"),
    writingMode: z.enum(['quick', 'outlined', 'polished']).describe('How many passes to spend on it'),
    targetMs: z.coerce
        .number()
        .int()
        .min(1000)
        .describe('How long it should run. What the beat count and the per-beat word budgets are computed from'),
    scheduledFor: _ZodDatetime.optional().describe('When it should air. Absent means as soon as it is made'),
});
export type ProductionInput = z.infer<typeof ProductionInput>;

/**
 * What an operator asks for. Everything else about a production is decided by the passes that make it
 * generated from [ProductionRequest](file://./../../../../data/contracts/productions/productions.types.ck#L29)
 */
export const ProductionRequest = z.strictObject({
    kind: z.string().min(1).max(100).optional(),
    title: z.string().min(1).max(300),
    brief: z.string().max(4000).optional(),
    personaId: z.string().max(100).optional(),
    writingMode: z.enum(['quick', 'outlined', 'polished']).optional().describe("Absent takes the station's `render.productionWritingMode`"),
    targetMs: z.coerce.number().int().min(1000).optional(),
    scheduledFor: _ZodDatetime.optional(),
});
export type ProductionRequest = z.infer<typeof ProductionRequest>;

/**
 * generated from [ProductionList](file://./../../../../data/contracts/productions/productions.types.ck#L24)
 */
export const ProductionList = z.strictObject({
    productions: z.array(Production),
});
export type ProductionList = z.infer<typeof ProductionList>;

export const ProductionListInput = z.strictObject({
    productions: z.array(ProductionInput),
});
export type ProductionListInput = z.infer<typeof ProductionListInput>;
