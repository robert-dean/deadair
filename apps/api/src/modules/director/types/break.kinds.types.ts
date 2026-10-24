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
 * One kind of break in a file: everything that says what it is, and nothing about how this station has it set
 * generated from [BreakKindFileKind](../../../../data/contracts/director/break.kinds.types.ck)
 */
export const BreakKindFileKind = z.strictObject({
    key: z
        .string()
        .min(1)
        .max(60)
        .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/)
        .describe('What identifies the kind across two stations, and what a band on the format clock names'),
    name: z.string().min(1).max(200),
    brief: z.string().min(1).max(4000),
    rules: z.array(z.string().min(1).max(500)).max(20),
    showsPrevious: z.preprocess(v => (v === 'true' ? true : v === 'false' ? false : v), z.boolean()),
    showsPlayed: z.preprocess(v => (v === 'true' ? true : v === 'false' ? false : v), z.boolean()),
    showsFacts: z.preprocess(v => (v === 'true' ? true : v === 'false' ? false : v), z.boolean()),
    showsNotebook: z.preprocess(v => (v === 'true' ? true : v === 'false' ? false : v), z.boolean()),
});
export type BreakKindFileKind = z.infer<typeof BreakKindFileKind>;

/**
 * Something to know before pressing Import
 * generated from [BreakKindImportNotice](../../../../data/contracts/director/break.kinds.types.ck)
 */
export const BreakKindImportNotice = z.strictObject({
    kind: z
        .enum(['format', 'duplicate', 'switched-off', 'refused'])
        .describe('Which sort, so a console can group by it rather than parsing the sentence'),
    message: z.string().min(1).max(500).describe("The whole of it, in the station's own words"),
});
export type BreakKindImportNotice = z.infer<typeof BreakKindImportNotice>;

export const BreakKindImportNoticeInput = z.strictObject({});
export type BreakKindImportNoticeInput = z.infer<typeof BreakKindImportNoticeInput>;

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

/**
 * Kinds of break as a file, to move between stations. No id, no place in a list and no switch: a kind arrives switched off wherever it lands, so it is read back before it airs
 * generated from [BreakKindFile](../../../../data/contracts/director/break.kinds.types.ck)
 */
export const BreakKindFile = z.strictObject({
    format: z.string().min(1).max(50).describe('What shape this is, so a file from a later build says so rather than being read wrongly'),
    takenAt: z.string().min(1).max(40).describe('When it was exported, ISO-8601'),
    station: z.string().max(100).optional().describe('The station it was taken from. Provenance only'),
    kinds: z.array(BreakKindFileKind).max(200),
});
export type BreakKindFile = z.infer<typeof BreakKindFile>;

/**
 * One kind in a file, and what would become of it here
 * generated from [BreakKindImportEntry](../../../../data/contracts/director/break.kinds.types.ck)
 */
export const BreakKindImportEntry = z.strictObject({
    key: z.string().min(1).max(60),
    name: z.string().min(1).max(200),
    outcome: z
        .enum(['create', 'update', 'skip', 'refuse'])
        .describe(
            'New here; already here and named in `replace`, so rewritten; already here and left alone; or a key this station uses for a break of its own, which no file can take',
        ),
    notices: z.array(BreakKindImportNotice),
});
export type BreakKindImportEntry = z.infer<typeof BreakKindImportEntry>;

export const BreakKindImportEntryInput = z.strictObject({});
export type BreakKindImportEntryInput = z.infer<typeof BreakKindImportEntryInput>;

/**
 * What importing a file WOULD do here, worked out by the same code the import runs and written nowhere
 * generated from [BreakKindImportPlan](../../../../data/contracts/director/break.kinds.types.ck)
 */
export const BreakKindImportPlan = z.strictObject({
    format: z.string().min(1).max(50).describe('What the file said it was'),
    station: z.string().max(100).optional().describe('The station it was taken from, when it said'),
    takenAt: z.string().max(40).optional().describe('When it was taken, when it said'),
    notices: z.array(BreakKindImportNotice).describe('About the file rather than any one kind in it'),
    kinds: z.array(BreakKindImportEntry),
});
export type BreakKindImportPlan = z.infer<typeof BreakKindImportPlan>;

export const BreakKindImportPlanInput = z.strictObject({});
export type BreakKindImportPlanInput = z.infer<typeof BreakKindImportPlanInput>;

/**
 * What importing did, with the plan it did it from. All or nothing
 * generated from [BreakKindImportResult](../../../../data/contracts/director/break.kinds.types.ck)
 */
export const BreakKindImportResult = z.strictObject({
    plan: BreakKindImportPlan,
    created: z.preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int().min(0)),
    updated: z
        .preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int().min(0))
        .describe('Kinds rewritten from the file, and switched off until read back'),
    skipped: z
        .preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int().min(0))
        .describe('Kinds this station already held and was not asked to replace, or could not take'),
    kinds: z.array(BreakKind).describe('The list as it now stands'),
});
export type BreakKindImportResult = z.infer<typeof BreakKindImportResult>;

export const BreakKindImportResultInput = z.strictObject({});
export type BreakKindImportResultInput = z.infer<typeof BreakKindImportResultInput>;
