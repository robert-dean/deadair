import { z } from 'zod';
import { DateTime } from 'luxon';

const _ZodDatetime = z.preprocess(
    val => (typeof val === 'string' ? DateTime.fromISO(val) : val),
    z.custom<DateTime>(val => val instanceof DateTime && val.isValid, { message: 'Must be in ISO 8601 format' }),
);

/**
 * A line the operator gives the presenters for a while. Talk breaks, banter between co-hosts and the
 * changeover into a show hear it as a lean on what they talk about, never as a fact to state or a
 * line to read out. Bulletins, the date, jingles and calls never hear it
 * generated from [TalkDirection](../../../../data/contracts/director/direction.types.ck)
 */
export const TalkDirection = z.strictObject({
    words: z.string().min(1).max(280).describe('What the presenters are told, as the operator wrote it'),
    endsAt: _ZodDatetime.describe('When the presenters stop hearing it'),
});
export type TalkDirection = z.infer<typeof TalkDirection>;

/**
 * Direct the presenters for a number of hours
 * generated from [TalkDirectionInput](../../../../data/contracts/director/direction.types.ck)
 */
export const TalkDirectionInput = z.strictObject({
    words: z
        .string()
        .min(1)
        .max(280)
        .describe('A lean for the presenters, such as "it\'s Sam\'s birthday tonight" or "we\'re snowed in, keep it cosy"'),
    hours: z
        .preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int().min(1).max(24))
        .describe('How long it lasts, from now'),
});
export type TalkDirectionInput = z.infer<typeof TalkDirectionInput>;

/**
 * The direction in force, or none
 * generated from [TalkDirectionReading](../../../../data/contracts/director/direction.types.ck)
 */
export const TalkDirectionReading = z.strictObject({
    direction: TalkDirection.optional().describe('Absent when nothing is directing the presenters, including once a direction has run out'),
});
export type TalkDirectionReading = z.infer<typeof TalkDirectionReading>;
