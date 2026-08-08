import { z } from 'zod';

/**
 * One thing the station can play that is not a record
 * generated from [Segment](file://./../../../../data/contracts/render/render.types.ck#L7)
 */
export const Segment = z.strictObject({
    id: z.string().min(1).max(100),
    kind: z.string().min(1).max(50).describe('What sort of element it is: `ident`, `stinger`, `talkbreak`, `news`'),
    state: z
        .enum(['planned', 'rendering', 'ready', 'failed'])
        .describe('Only `ready` can go on air. The station skips anything else rather than waiting for it'),
    label: z.string().min(1).max(400).describe('What the console calls it, and what the mount is labelled with while it airs'),
    source: z.string().min(1).max(50).describe('Who made it: `library` for a file dropped into the inbox'),
    playable: z.preprocess(v => (v === 'true' ? true : v === 'false' ? false : v), z.boolean()).describe('Whether there is audio behind it yet'),
    script: z.string().max(20000).optional().describe('The words, for anything that speaks. Absent for an imported recording'),
    sourcePath: z
        .string()
        .max(1000)
        .optional()
        .describe('The file in the inbox this came from. The bytes were copied, so emptying the inbox does not take it off the air'),
    durationMs: z.coerce.number().int().min(0).optional().describe('How long it runs. A display value: the player measures the audio itself'),
    error: z.string().max(2000).optional().describe('Why it is `failed`'),
    voice: z
        .string()
        .max(100)
        .optional()
        .describe("The station's own name for the voice this is said in, e.g. `host`. Absent means the speech plugin's default"),
});
export type Segment = z.infer<typeof Segment>;

/**
 * Something for the station to say, before anything has said it
 * generated from [SegmentCreate](file://./../../../../data/contracts/render/render.types.ck#L21)
 */
export const SegmentCreate = z.strictObject({
    label: z.string().min(1).max(400).describe('What the console calls it, and what the mount is labelled with while it airs'),
    script: z.string().min(1).max(20000).describe('The words to say'),
    kind: z.string().min(1).max(50).optional().describe('What sort of element it is. Defaults to `talkbreak`'),
    voice: z.string().max(100).optional().describe('A station voice name the speech plugin knows how to map. Absent uses its default'),
});
export type SegmentCreate = z.infer<typeof SegmentCreate>;

/**
 * What one pass over the inbox did
 * generated from [SegmentScanResult](file://./../../../../data/contracts/render/render.types.ck#L32)
 */
export const SegmentScanResult = z.strictObject({
    scanned: z.coerce.number().int().min(0).describe('Audio files seen, whether or not they were already known'),
    imported: z.coerce.number().int().min(0).describe('Segments the station did not have before this pass'),
    skipped: z.coerce.number().int().min(0).describe('Files passed over: not audio it can serve, or unreadable'),
});
export type SegmentScanResult = z.infer<typeof SegmentScanResult>;

/**
 * Everything the station can play that is not a record
 * generated from [SegmentList](file://./../../../../data/contracts/render/render.types.ck#L28)
 */
export const SegmentList = z.strictObject({
    segments: z.array(Segment),
});
export type SegmentList = z.infer<typeof SegmentList>;
