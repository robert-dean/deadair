import { z } from 'zod';
import { DateTime } from 'luxon';

const _ZodDatetime = z.preprocess(
    val => (typeof val === 'string' ? DateTime.fromISO(val) : val),
    z.custom<DateTime>(val => val instanceof DateTime && val.isValid, { message: 'Must be in ISO 8601 format' }),
);

/**
 * A never-play rule: a KIND of record the station must not play. Absolute, like a dislike, and
 * exclude-only: there is no "only these" rule, because one could leave the station nothing to play.
 * Every scope is optional and an absent one means "always"
 * generated from [BlockRule](../../../../data/contracts/director/rules.types.ck#L10)
 */
export const BlockRule = z.strictObject({
    id: z.uuid(),
    field: z
        .enum(['genre', 'tag'])
        .describe(
            '`genre` refuses any record tagged with this genre or a kind of it (`Punk Rock` under `Punk`, never `Pop` under `Pop Punk`, never `Trap` under `Rap`). `tag` refuses a record carrying exactly this tag',
        ),
    value: z.string().min(1).max(200).describe('The genre or tag, as you would write it'),
    seasonFrom: z
        .string()
        .min(5)
        .max(5)
        .optional()
        .describe('First day it holds, as `MM-DD`. With `seasonTo`; a season starting after it ends wraps the year end'),
    seasonTo: z.string().min(5).max(5).optional().describe('Last day it holds, as `MM-DD`'),
    fromHour: z
        .preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int().min(0).max(23))
        .optional()
        .describe("First hour of the station's day it holds. With `untilHour`; a window starting after it ends wraps midnight"),
    untilHour: z
        .preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int().min(0).max(24))
        .optional()
        .describe('The hour it stops holding, exclusive'),
    modes: z
        .array(z.enum(['rotation', 'setlist', 'feature']))
        .optional()
        .describe('Only while the station is in one of these modes. Absent or empty means every mode'),
    slotIds: z.array(z.string().min(1).max(100)).optional().describe('Only during these schedule blocks. Absent or empty means whatever is on'),
    endsAt: _ZodDatetime.optional().describe('When it stops holding. Absent means until it is removed'),
    inForce: z
        .preprocess(v => (v === 'true' ? true : v === 'false' ? false : v), z.boolean())
        .describe("Whether it holds right now, on the station's clock, for what is on air"),
});
export type BlockRule = z.infer<typeof BlockRule>;

export const BlockRuleInput = z.strictObject({
    field: z
        .enum(['genre', 'tag'])
        .describe(
            '`genre` refuses any record tagged with this genre or a kind of it (`Punk Rock` under `Punk`, never `Pop` under `Pop Punk`, never `Trap` under `Rap`). `tag` refuses a record carrying exactly this tag',
        ),
    value: z.string().min(1).max(200).describe('The genre or tag, as you would write it'),
    seasonFrom: z
        .string()
        .min(5)
        .max(5)
        .optional()
        .describe('First day it holds, as `MM-DD`. With `seasonTo`; a season starting after it ends wraps the year end'),
    seasonTo: z.string().min(5).max(5).optional().describe('Last day it holds, as `MM-DD`'),
    fromHour: z
        .preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int().min(0).max(23))
        .optional()
        .describe("First hour of the station's day it holds. With `untilHour`; a window starting after it ends wraps midnight"),
    untilHour: z
        .preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int().min(0).max(24))
        .optional()
        .describe('The hour it stops holding, exclusive'),
    modes: z
        .array(z.enum(['rotation', 'setlist', 'feature']))
        .optional()
        .describe('Only while the station is in one of these modes. Absent or empty means every mode'),
    slotIds: z.array(z.string().min(1).max(100)).optional().describe('Only during these schedule blocks. Absent or empty means whatever is on'),
    endsAt: _ZodDatetime.optional().describe('When it stops holding. Absent means until it is removed'),
});
export type BlockRuleInput = z.infer<typeof BlockRuleInput>;

/**
 * A lean toward some genres for a while. The opposite of a rule: the station favours them when it
 * chooses records, and still plays anything else rather than run dry
 * generated from [GenreSteer](../../../../data/contracts/director/rules.types.ck#L31)
 */
export const GenreSteer = z.strictObject({
    genres: z
        .array(z.string().min(1).max(100))
        .min(1)
        .max(20)
        .describe('What to favour, as genres. A record tagged with any of them, or a kind of one, is preferred'),
    endsAt: _ZodDatetime.describe('When the station goes back to choosing as it ordinarily does'),
});
export type GenreSteer = z.infer<typeof GenreSteer>;

/**
 * Lean the station toward some genres for a number of hours
 * generated from [GenreSteerInput](../../../../data/contracts/director/rules.types.ck#L42)
 */
export const GenreSteerInput = z.strictObject({
    genres: z.array(z.string().min(1).max(100)).min(1).max(20),
    hours: z
        .preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int().min(1).max(24))
        .describe('How long it lasts, from now'),
});
export type GenreSteerInput = z.infer<typeof GenreSteerInput>;

/**
 * Every rule on the station, newest first
 * generated from [BlockRuleList](../../../../data/contracts/director/rules.types.ck#L25)
 */
export const BlockRuleList = z.strictObject({
    rules: z.array(BlockRule),
});
export type BlockRuleList = z.infer<typeof BlockRuleList>;

export const BlockRuleListInput = z.strictObject({
    rules: z.array(BlockRuleInput),
});
export type BlockRuleListInput = z.infer<typeof BlockRuleListInput>;

/**
 * The lean in force, or none
 * generated from [GenreSteerReading](../../../../data/contracts/director/rules.types.ck#L37)
 */
export const GenreSteerReading = z.strictObject({
    steer: GenreSteer.optional().describe('Absent when nothing is leaning the station, including once one has run out'),
});
export type GenreSteerReading = z.infer<typeof GenreSteerReading>;
