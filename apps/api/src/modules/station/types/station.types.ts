import { z } from 'zod';

/**
 * One thing that wants the operator's attention, or the fact that nothing does
 * generated from [AttentionItem](file://./../../../../data/contracts/station/station.types.ck#L8)
 */
export const AttentionItem = z.strictObject({
    code: z
        .string()
        .min(1)
        .max(60)
        .describe(
            'What this is, as a stable key: `silence`, `benchedCopies`, `noPersona`. The console groups and counts on it rather than on the sentence',
        ),
    severity: z
        .enum(['failure', 'warning', 'notice'])
        .describe(
            '`failure` is the station not doing its job, `warning` is something failing beside a station that is working, and `notice` is a thing nobody has set up yet. A notice is not a fault and must not be drawn as one',
        ),
    title: z.string().min(1).max(120).describe('The line an operator reads first'),
    detail: z
        .string()
        .min(1)
        .max(800)
        .describe(
            'The whole of it, in a sentence. Where the station already has words for a fact, these are those words rather than a second phrasing of them',
        ),
    route: z.string().min(1).max(200).describe('The console page that can do something about it'),
    count: z.coerce.number().int().min(0).optional().describe('How many things this is about, where that is a number rather than a state'),
});
export type AttentionItem = z.infer<typeof AttentionItem>;

/**
 * Everything wrong or waiting, worst first
 * generated from [StationAttention](file://./../../../../data/contracts/station/station.types.ck#L18)
 */
export const StationAttention = z.strictObject({
    items: z.array(AttentionItem),
});
export type StationAttention = z.infer<typeof StationAttention>;
