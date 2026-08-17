import { z } from 'zod';
import { DateTime } from 'luxon';

const _ZodDatetime = z.preprocess(
    val => (typeof val === 'string' ? DateTime.fromISO(val) : val),
    z.custom<DateTime>(val => val instanceof DateTime && val.isValid, { message: 'Must be in ISO 8601 format' }),
);

/**
 * One thing the station can play that is not a record
 * generated from [Segment](file://./../../../../data/contracts/render/render.types.ck#L7)
 */
export const Segment = z.strictObject({
    id: z.string().min(1).max(100),
    kind: z.string().min(1).max(50).describe('What sort of element it is: `ident`, `stinger`, `talkbreak`, `news`'),
    state: z
        .enum(['planned', 'writing', 'written', 'rendering', 'ready', 'failed'])
        .describe('One state per stage of making it. Only `ready` can go on air; the station skips anything else rather than waiting for it'),
    label: z.string().min(1).max(400).describe('What the console calls it, and what the mount is labelled with while it airs'),
    source: z.string().min(1).max(50).describe('Who made it: `library` for a file dropped into the inbox'),
    playable: z.preprocess(v => (v === 'true' ? true : v === 'false' ? false : v), z.boolean()).describe('Whether there is audio behind it yet'),
    script: z.string().max(20000).optional().describe('The words, for anything that speaks. Absent for an imported recording'),
    spokenScript: z
        .string()
        .max(20000)
        .optional()
        .describe(
            "The words as the speech engine was handed them: symbols said, years read as a person reads them, the station's pronunciation list applied. Absent until something has spoken it",
        ),
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
 * generated from [SegmentCreate](file://./../../../../data/contracts/render/render.types.ck#L22)
 */
export const SegmentCreate = z.strictObject({
    label: z.string().min(1).max(400).describe('What the console calls it, and what the mount is labelled with while it airs'),
    script: z.string().min(1).max(20000).describe('The words to say'),
    kind: z.string().min(1).max(50).optional().describe('What sort of element it is. Defaults to `talkbreak`'),
    voice: z.string().max(100).optional().describe('A station voice name the speech plugin knows how to map. Absent uses its default'),
});
export type SegmentCreate = z.infer<typeof SegmentCreate>;

/**
 * A voice the station can be asked to speak in
 * generated from [Voice](file://./../../../../data/contracts/render/render.types.ck#L33)
 */
export const Voice = z.strictObject({
    id: z.string().max(100).describe("What to pass as a segment's `voice`. Empty means the plugin's own default"),
    label: z.string().min(1).max(200).describe('What the console calls it'),
    description: z.string().max(500).optional().describe('What it sounds like, or what it maps to on the engine'),
});
export type Voice = z.infer<typeof Voice>;

/**
 * Whether there are words, and if not, which way it went wrong
 * generated from [ScriptOutcome](file://./../../../../data/contracts/render/render.types.ck#L45)
 */
export const ScriptOutcome = z.enum(['written', 'declined', 'failed']);
export type ScriptOutcome = z.infer<typeof ScriptOutcome>;

/**
 * A record a writer was told about, kept as it was told
 * generated from [ScriptNeighbour](file://./../../../../data/contracts/render/render.types.ck#L47)
 */
export const ScriptNeighbour = z.strictObject({
    title: z.string().min(1).max(500),
    artist: z.string().min(1).max(500),
    facts: z
        .array(z.string().max(1000))
        .optional()
        .describe(
            'What it was shown about the record. A break that said nothing interesting and one that was TOLD nothing interesting read the same from the script alone',
        ),
});
export type ScriptNeighbour = z.infer<typeof ScriptNeighbour>;

/**
 * What the provider said the attempt cost, when it said anything
 * generated from [ScriptUsage](file://./../../../../data/contracts/render/render.types.ck#L53)
 */
export const ScriptUsage = z.strictObject({
    inputTokens: z.coerce.number().int().min(0).optional(),
    outputTokens: z.coerce.number().int().min(0).optional(),
    totalTokens: z.coerce.number().int().min(0).optional(),
});
export type ScriptUsage = z.infer<typeof ScriptUsage>;

/**
 * One turn of the conversation a writer sent
 * generated from [ScriptPromptMessage](file://./../../../../data/contracts/render/render.types.ck#L59)
 */
export const ScriptPromptMessage = z.strictObject({
    role: z.string().min(1).max(50),
    content: z.string().max(100000),
});
export type ScriptPromptMessage = z.infer<typeof ScriptPromptMessage>;

/**
 * What one pass over the inbox did
 * generated from [SegmentScanResult](file://./../../../../data/contracts/render/render.types.ck#L97)
 */
export const SegmentScanResult = z.strictObject({
    scanned: z.coerce.number().int().min(0).describe('Audio files seen, whether or not they were already known'),
    imported: z.coerce.number().int().min(0).describe('Segments the station did not have before this pass'),
    skipped: z.coerce.number().int().min(0).describe('Files passed over: not audio it can serve, or unreadable'),
});
export type SegmentScanResult = z.infer<typeof SegmentScanResult>;

/**
 * Everything the station can play that is not a record
 * generated from [SegmentList](file://./../../../../data/contracts/render/render.types.ck#L29)
 */
export const SegmentList = z.strictObject({
    segments: z.array(Segment),
});
export type SegmentList = z.infer<typeof SegmentList>;

/**
 * The voices the station's current speech plugin offers
 * generated from [VoiceList](file://./../../../../data/contracts/render/render.types.ck#L39)
 */
export const VoiceList = z.strictObject({
    voices: z.array(Voice),
    pluginId: z.string().max(200).optional().describe('Which plugin answered. Absent when nothing can speak'),
    reason: z.string().max(500).optional().describe('Why there are no voices, when there are none'),
});
export type VoiceList = z.infer<typeof VoiceList>;

/**
 * One page of what the station has written, newest first
 * generated from [ScriptHistoryQuery](file://./../../../../data/contracts/render/render.types.ck#L84)
 */
export const ScriptHistoryQuery = z.strictObject({
    limit: z.coerce.number().int().min(1).max(200).optional(),
    before: z
        .string()
        .min(1)
        .max(200)
        .optional()
        .describe(
            'Where the previous page ended. Opaque, and a keyset rather than an offset because rows arrive at the head continuously. Pass back whatever `nextBefore` said and nothing else',
        ),
    kind: z.string().min(1).max(50).optional(),
    writer: z.string().min(1).max(100).optional(),
    outcome: ScriptOutcome.optional(),
});
export type ScriptHistoryQuery = z.infer<typeof ScriptHistoryQuery>;

/**
 * One attempt to write something the station would say, including the ones that came to nothing
 * generated from [ScriptAttempt](file://./../../../../data/contracts/render/render.types.ck#L64)
 */
export const ScriptAttempt = z.strictObject({
    id: z.string().min(1).max(100),
    at: _ZodDatetime,
    kind: z.string().min(1).max(50).describe('What sort of break it was for: `talkbreak`, `welcome`, `news`'),
    writer: z.string().min(1).max(100).describe('The binding that produced or declined it'),
    outcome: ScriptOutcome,
    label: z.string().max(400).optional(),
    script: z.string().max(20000).optional().describe('The words. Absent for an attempt that produced none'),
    model: z.string().max(200).optional().describe('The model that said it, for a writer that used one'),
    source: z.string().max(200).optional().describe('What the line was rendered from, for a writer working from something an operator can edit'),
    reason: z.string().max(2000).optional().describe('Why, for anything that is not `written`'),
    segmentId: z.string().max(100).optional().describe('The segment this was for, while it is still known. The row outlives it'),
    previous: ScriptNeighbour.optional(),
    next: ScriptNeighbour.optional(),
    durationMs: z.coerce.number().int().min(0).optional().describe('How long the attempt took'),
    usage: ScriptUsage.optional(),
    raw: z.string().max(100000).optional().describe('The answer before anything read it. Only while `llm.captureWrites` is on'),
    prompt: z.array(ScriptPromptMessage).optional().describe('What the writer sent. Only while `llm.captureWrites` is on'),
});
export type ScriptAttempt = z.infer<typeof ScriptAttempt>;

/**
 * generated from [ScriptHistoryPage](file://./../../../../data/contracts/render/render.types.ck#L92)
 */
export const ScriptHistoryPage = z.strictObject({
    attempts: z.array(ScriptAttempt),
    nextBefore: z
        .string()
        .min(1)
        .max(200)
        .optional()
        .describe('The cursor for the page after this one, absent once the history has been read to its end'),
});
export type ScriptHistoryPage = z.infer<typeof ScriptHistoryPage>;
