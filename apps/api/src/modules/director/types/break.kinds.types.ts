import { z } from 'zod';

/**
 * A kind of break you write yourself: a brief in prose, and what the presenter is shown while writing one
 * generated from [BreakKind](../../../../data/contracts/director/break.kinds.types.ck)
 */
export const BreakKind = z.strictObject({
    id: z.string().min(1).max(100),
    key: z
        .string()
        .min(1)
        .max(60)
        .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/)
        .describe(
            'The kind, as a band on the format clock names it: lowercase words joined by hyphens. Fixed once the kind is created, because every band and every break it ever planted carries it',
        ),
    name: z.string().min(1).max(200).describe('What the console calls it. Never read out'),
    brief: z
        .string()
        .min(1)
        .max(4000)
        .describe(
            "What this kind of break is for and when to say nothing, written as an instruction to the presenter. The station's own rules for every break still apply on top of it",
        ),
    rules: z
        .array(z.string().min(1).max(500))
        .max(20)
        .describe('Anything this kind owes beyond the rules every break owes, one per entry. Added to those rules, never in place of them'),
    showsPrevious: z
        .preprocess(v => (v === 'true' ? true : v === 'false' ? false : v), z.boolean())
        .describe('Whether the presenter is shown the record that has just finished'),
    showsPlayed: z
        .preprocess(v => (v === 'true' ? true : v === 'false' ? false : v), z.boolean())
        .describe("Whether the presenter is shown the rest of this broadcast's records, to refer back to"),
    showsFacts: z
        .preprocess(v => (v === 'true' ? true : v === 'false' ? false : v), z.boolean())
        .describe('Whether the records shown carry the notes the station holds about them'),
    showsNotebook: z
        .preprocess(v => (v === 'true' ? true : v === 'false' ? false : v), z.boolean())
        .describe('Whether the presenter is shown their own notebook'),
    enabled: z
        .preprocess(v => (v === 'true' ? true : v === 'false' ? false : v), z.boolean())
        .describe('Whether the station writes this kind at all. A new or imported kind is off until you switch it on'),
    position: z
        .preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int().min(0))
        .describe('Your own order, for the list'),
});
export type BreakKind = z.infer<typeof BreakKind>;

export const BreakKindInput = z.strictObject({
    key: z
        .string()
        .min(1)
        .max(60)
        .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/)
        .describe(
            'The kind, as a band on the format clock names it: lowercase words joined by hyphens. Fixed once the kind is created, because every band and every break it ever planted carries it',
        ),
    name: z.string().min(1).max(200).describe('What the console calls it. Never read out'),
    brief: z
        .string()
        .min(1)
        .max(4000)
        .describe(
            "What this kind of break is for and when to say nothing, written as an instruction to the presenter. The station's own rules for every break still apply on top of it",
        ),
    rules: z
        .array(z.string().min(1).max(500))
        .max(20)
        .describe('Anything this kind owes beyond the rules every break owes, one per entry. Added to those rules, never in place of them'),
    showsPrevious: z
        .preprocess(v => (v === 'true' ? true : v === 'false' ? false : v), z.boolean())
        .describe('Whether the presenter is shown the record that has just finished'),
    showsPlayed: z
        .preprocess(v => (v === 'true' ? true : v === 'false' ? false : v), z.boolean())
        .describe("Whether the presenter is shown the rest of this broadcast's records, to refer back to"),
    showsFacts: z
        .preprocess(v => (v === 'true' ? true : v === 'false' ? false : v), z.boolean())
        .describe('Whether the records shown carry the notes the station holds about them'),
    showsNotebook: z
        .preprocess(v => (v === 'true' ? true : v === 'false' ? false : v), z.boolean())
        .describe('Whether the presenter is shown their own notebook'),
    enabled: z
        .preprocess(v => (v === 'true' ? true : v === 'false' ? false : v), z.boolean())
        .describe('Whether the station writes this kind at all. A new or imported kind is off until you switch it on'),
    position: z
        .preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int().min(0))
        .describe('Your own order, for the list'),
});
export type BreakKindInput = z.infer<typeof BreakKindInput>;

/**
 * generated from [BreakKindList](../../../../data/contracts/director/break.kinds.types.ck)
 */
export const BreakKindList = z.strictObject({
    kinds: z.array(BreakKind),
});
export type BreakKindList = z.infer<typeof BreakKindList>;

export const BreakKindListInput = z.strictObject({
    kinds: z.array(BreakKindInput),
});
export type BreakKindListInput = z.infer<typeof BreakKindListInput>;
