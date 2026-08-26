import { z } from 'zod';
import { DateTime } from 'luxon';

const _ZodBinary = z.custom<Buffer>(val => Buffer.isBuffer(val), { error: 'Must be binary data' });
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
 * What an operator thought of something the station said.
 *
 * The catalog's three spellings exactly, and deliberately not a second vocabulary: an opinion is an
 * opinion whether it is about a record or about a sentence, and `catalog/rating.ts` is the one place
 * the words and the column's numbers meet.
 *
 * `neutral` is a real answer rather than an absence. Rating something back to nothing is a thing an
 * operator does, and it has to be distinguishable from never having listened, which is the field
 * being absent on the attempt.
 * generated from [ScriptRating](file://./../../../../data/contracts/render/render.types.ck#L95)
 */
export const ScriptRating = z.enum(['liked', 'neutral', 'disliked']);
export type ScriptRating = z.infer<typeof ScriptRating>;

/**
 * Words to hear before anything has aired them
 * generated from [SpeechPreviewRequest](file://./../../../../data/contracts/render/render.types.ck#L116)
 */
export const SpeechPreviewRequest = z.strictObject({
    text: z
        .string()
        .min(1)
        .max(2000)
        .describe(
            "What to say. Far under a segment's 20000 because this is one break heard once, and the cap is what bounds a cache keyed on the words themselves",
        ),
    voice: z.string().max(100).optional().describe("A station voice name, as a segment's `voice`. Absent uses the plugin's own default"),
});
export type SpeechPreviewRequest = z.infer<typeof SpeechPreviewRequest>;

/**
 * The window the counts cover
 * generated from [ScriptHistorySummaryQuery](file://./../../../../data/contracts/render/render.types.ck#L121)
 */
export const ScriptHistorySummaryQuery = z.strictObject({
    hours: z.coerce
        .number()
        .int()
        .min(1)
        .max(168)
        .optional()
        .describe(
            'How far back to count. Defaults to 24, and a week at most, because past that the nightly sweep may already have taken the rows and the count would quietly be of what survived rather than of what happened',
        ),
});
export type ScriptHistorySummaryQuery = z.infer<typeof ScriptHistorySummaryQuery>;

/**
 * One presenter's attempts in the window
 * generated from [ScriptHistorySummaryRow](file://./../../../../data/contracts/render/render.types.ck#L125)
 */
export const ScriptHistorySummaryRow = z.strictObject({
    personaKey: z
        .string()
        .max(100)
        .optional()
        .describe('Absent means nobody was presenting, which is an ordinary state rather than a gap in the data'),
    written: z.coerce.number().int().min(0),
    declined: z.coerce
        .number()
        .int()
        .min(0)
        .describe('A decline is the writer registry working: the model had nothing to say and the floor covered for it'),
    failed: z.coerce.number().int().min(0),
});
export type ScriptHistorySummaryRow = z.infer<typeof ScriptHistorySummaryRow>;

/**
 * What one pass over the inbox did
 * generated from [SegmentScanResult](file://./../../../../data/contracts/render/render.types.ck#L137)
 */
export const SegmentScanResult = z.strictObject({
    scanned: z.coerce.number().int().min(0).describe('Audio files seen, whether or not they were already known'),
    imported: z.coerce.number().int().min(0).describe('Segments the station did not have before this pass'),
    skipped: z.coerce.number().int().min(0).describe('Files passed over: not audio it can serve, or unreadable'),
});
export type SegmentScanResult = z.infer<typeof SegmentScanResult>;

/**
 * One name the station says differently from how it is written
 * generated from [Pronunciation](file://./../../../../data/contracts/render/render.types.ck#L143)
 */
export const Pronunciation = z.strictObject({
    id: z.string().min(1).max(100),
    written: z.string().min(1).max(200).describe('What appears in a script. Matched case-insensitively, and whole words only'),
    spoken: z
        .string()
        .max(400)
        .describe(
            'What the engine is handed instead, untouched. EMPTY is meaningful: it drops the words, which is the honest reading for a marker that got into a title and is not a word',
        ),
    state: z
        .enum(['active', 'suggested', 'rejected'])
        .describe(
            '`active` is said. `suggested` is proposed and says nothing yet. `rejected` outlives the pass that proposed it, or the same article proposes it again forever',
        ),
    origin: z.enum(['operator', 'gloss']).describe('Who says so. `gloss` is a pronunciation key an encyclopaedia article printed for itself'),
    sourceUrl: z.string().max(2000).optional().describe('The article. Present on anything an operator did not type'),
    sourceQuote: z
        .string()
        .max(2000)
        .optional()
        .describe('The sentence that says so, as it stands in the article, which is what the decision is actually made on'),
    subjectKind: z.enum(['track', 'album', 'artist']).optional().describe('What the article was about'),
    subjectId: z.string().max(100).optional(),
    createdAt: z.string().min(1).max(40),
});
export type Pronunciation = z.infer<typeof Pronunciation>;

/**
 * A name and how to say it
 * generated from [PronunciationWrite](file://./../../../../data/contracts/render/render.types.ck#L160)
 */
export const PronunciationWrite = z.strictObject({
    written: z.string().min(1).max(200),
    spoken: z.string().max(400).describe('Empty drops the words rather than saying them'),
});
export type PronunciationWrite = z.infer<typeof PronunciationWrite>;

/**
 * Accepting a proposal, turning one down, or taking an entry out of use without losing it
 * generated from [PronunciationStateWrite](file://./../../../../data/contracts/render/render.types.ck#L165)
 */
export const PronunciationStateWrite = z.strictObject({
    state: z.enum(['active', 'suggested', 'rejected']),
});
export type PronunciationStateWrite = z.infer<typeof PronunciationStateWrite>;

/**
 * Which part of the lexicon to read
 * generated from [PronunciationQuery](file://./../../../../data/contracts/render/render.types.ck#L169)
 */
export const PronunciationQuery = z.strictObject({
    state: z.enum(['active', 'suggested', 'rejected']).optional().describe('Absent is all of it'),
});
export type PronunciationQuery = z.infer<typeof PronunciationQuery>;

/**
 * One sound on a soundboard, as the console draws it.
 *
 * `name` is what a script writes to hit it and `label` is what a person reads: two columns rather
 * than one, because a token for a model and prose for an operator are different things and the
 * filename produces both
 * generated from [Pad](file://./../../../../data/contracts/render/render.types.ck#L178)
 */
export const Pad = z.strictObject({
    id: z.uuid(),
    board: z.string().min(1).max(200).describe('Which directory it arrived in. Provenance: what reaches it is a set'),
    sets: z.array(z.string().min(1).max(200)).describe('The keys of the sets it is on. Empty means it is in the library and nothing can hit it'),
    name: z.string().min(1).max(200).describe('What a script writes: `[sfx:airhorn]`'),
    label: z.string().min(1).max(200),
    durationMs: z.coerce.number().int().min(0).optional(),
    loudnessLufs: z.coerce
        .number()
        .optional()
        .describe('How loud it came out, once something measured it. Absent on a station with no analyzer, which is ordinary'),
    source: z
        .string()
        .min(1)
        .max(50)
        .describe(
            'Who put the file there: `library` for one the operator dropped in, `upload` or `url` for one the console wrote. It decides whether the console may delete it',
        ),
    sourcePath: z
        .string()
        .max(500)
        .optional()
        .describe('The file in the library directory it was imported from, so the console can say where it came from'),
    lastUsedAt: _ZodDatetime.optional().describe('When it was last hit. Absent for one nothing has reached for yet'),
    state: z.enum(['active', 'rejected']),
});
export type Pad = z.infer<typeof Pad>;

export const PadInput = z.strictObject({
    board: z.string().min(1).max(200).describe('Which directory it arrived in. Provenance: what reaches it is a set'),
    name: z.string().min(1).max(200).describe('What a script writes: `[sfx:airhorn]`'),
    label: z.string().min(1).max(200),
    durationMs: z.coerce.number().int().min(0).optional(),
    loudnessLufs: z.coerce
        .number()
        .optional()
        .describe('How loud it came out, once something measured it. Absent on a station with no analyzer, which is ordinary'),
    sourcePath: z
        .string()
        .max(500)
        .optional()
        .describe('The file in the library directory it was imported from, so the console can say where it came from'),
    lastUsedAt: _ZodDatetime.optional().describe('When it was last hit. Absent for one nothing has reached for yet'),
    state: z.enum(['active', 'rejected']),
});
export type PadInput = z.infer<typeof PadInput>;

/**
 * A sound arriving from the browser, as multipart form parts.
 *
 * Documentation rather than validation: a multipart body reaches the service as the raw parser and
 * the generated client types the body as `FormData`, so nothing checks this shape. It says what to
 * send
 * generated from [PadUpload](file://./../../../../data/contracts/render/render.types.ck#L197)
 */
export const PadUpload = z.strictObject({
    file: _ZodBinary.describe('The audio itself. mp3, wav, ogg, flac or m4a, and at most 25 MB'),
    board: z.string().min(1).max(200).describe('The directory it is filed under, which is also the set it joins. A new name makes both'),
    name: z
        .string()
        .min(1)
        .max(200)
        .optional()
        .describe('What a script will write. Derived from the filename when absent, and the FILE is named after this either way'),
    label: z.string().min(1).max(200).optional().describe('What the console calls it. Derived from the filename when absent'),
});
export type PadUpload = z.infer<typeof PadUpload>;

/**
 * A sound the station is being told to go and get.
 *
 * The operator names the address, so this is them choosing a file exactly as dropping one in the
 * library is. Nothing inspects what comes back and nothing records a claim about its licence -- see
 * `docs/decisions/pad-licensing.md`, whose line is redistribution rather than use
 * generated from [PadFetch](file://./../../../../data/contracts/render/render.types.ck#L209)
 */
export const PadFetch = z.strictObject({
    url: z.url().describe('Where the audio is. Followed once, bounded, and refused unless what comes back is a format the station serves'),
    board: z.string().min(1).max(200).describe('The directory it is filed under, which is also the set it joins'),
    name: z.string().min(1).max(200).optional().describe('What a script will write. Derived from the address when absent'),
    label: z.string().min(1).max(200).optional(),
});
export type PadFetch = z.infer<typeof PadFetch>;

/**
 * A named collection of pads: what a presenter is actually handed.
 *
 * One library, cut as many ways as an operator likes. `personas.soundboard` holds the `key`, so
 * renaming a set unpoints every persona naming it — which is why `personas` says who those are
 * generated from [PadSet](file://./../../../../data/contracts/render/render.types.ck#L225)
 */
export const PadSet = z.strictObject({
    id: z.uuid(),
    key: z.string().min(1).max(200).describe('The slug a persona names. A directory in the pad library makes one of these'),
    label: z.string().min(1).max(200),
    position: z.coerce.number().int().min(0),
    pads: z.coerce
        .number()
        .int()
        .min(0)
        .describe('How many sounds are on it. Zero is ordinary: it is what a set looks like before anybody drops a file'),
    personas: z.array(z.string().min(1).max(200)).describe('Who is pointed at it, so a rename or a delete can say what it is about to unpoint'),
});
export type PadSet = z.infer<typeof PadSet>;

export const PadSetInput = z.strictObject({
    key: z.string().min(1).max(200).describe('The slug a persona names. A directory in the pad library makes one of these'),
    label: z.string().min(1).max(200),
    position: z.coerce.number().int().min(0),
});
export type PadSetInput = z.infer<typeof PadSetInput>;

/**
 * A set an operator is naming, or renaming
 * generated from [PadSetWrite](file://./../../../../data/contracts/render/render.types.ck#L234)
 */
export const PadSetWrite = z.strictObject({
    key: z.string().min(1).max(200),
    label: z.string().min(1).max(200),
    position: z.coerce.number().int().min(0).optional(),
});
export type PadSetWrite = z.infer<typeof PadSetWrite>;

/**
 * Which pad, and whether it is on the set
 * generated from [PadSetMembership](file://./../../../../data/contracts/render/render.types.ck#L240)
 */
export const PadSetMembership = z.strictObject({
    padId: z.uuid(),
    on: z.preprocess(v => (v === 'true' ? true : v === 'false' ? false : v), z.boolean()),
});
export type PadSetMembership = z.infer<typeof PadSetMembership>;

/**
 * Turning a pad down, or putting one back
 * generated from [PadState](file://./../../../../data/contracts/render/render.types.ck#L245)
 */
export const PadState = z.strictObject({
    state: z.enum(['active', 'rejected']),
});
export type PadState = z.infer<typeof PadState>;

/**
 * What one pass over the pad library did
 * generated from [PadScanResult](file://./../../../../data/contracts/render/render.types.ck#L249)
 */
export const PadScanResult = z.strictObject({
    scanned: z.coerce.number().int().min(0).describe('Audio files seen, whether or not anything changed'),
    imported: z.coerce.number().int().min(0).describe('Sounds the station did not have before'),
    replaced: z.coerce.number().int().min(0).describe('Slots whose file changed under them, which every script naming them now plays'),
    contested: z.coerce
        .number()
        .int()
        .min(0)
        .describe(
            'Sounds that reached the library but not their set, because it already answered to their name. In the library and unreachable until somebody says where they go',
        ),
    skipped: z.coerce.number().int().min(0).describe('Files passed over: not audio, unreadable, or named something no script could write'),
});
export type PadScanResult = z.infer<typeof PadScanResult>;

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
 * generated from [ScriptHistoryQuery](file://./../../../../data/contracts/render/render.types.ck#L101)
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
    personaKey: z.string().min(1).max(100).optional().describe('Everything ONE character has said. Absent is every character and none'),
    segmentId: z
        .string()
        .min(1)
        .max(100)
        .optional()
        .describe(
            'Every attempt made for ONE break, which is how a console reaches the words behind an item of the running order. Absent is the whole history',
        ),
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
    personaKey: z
        .string()
        .max(100)
        .optional()
        .describe(
            "Who was presenting, as the persona's own key. Absent means nobody was, which is an ordinary state. Stamped on every attempt including the declined ones, so a character whose model breaks are all being refused is visible rather than hidden behind the floor",
        ),
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
    rating: ScriptRating.optional().describe('What the operator thought of it. ABSENT means nobody has said, which `neutral` does not'),
});
export type ScriptAttempt = z.infer<typeof ScriptAttempt>;

export const ScriptAttemptInput = z.strictObject({
    id: z.string().min(1).max(100),
    at: _ZodDatetime,
    kind: z.string().min(1).max(50).describe('What sort of break it was for: `talkbreak`, `welcome`, `news`'),
    writer: z.string().min(1).max(100).describe('The binding that produced or declined it'),
    outcome: ScriptOutcome,
    personaKey: z
        .string()
        .max(100)
        .optional()
        .describe(
            "Who was presenting, as the persona's own key. Absent means nobody was, which is an ordinary state. Stamped on every attempt including the declined ones, so a character whose model breaks are all being refused is visible rather than hidden behind the floor",
        ),
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
export type ScriptAttemptInput = z.infer<typeof ScriptAttemptInput>;

/**
 * generated from [ScriptRatingInput](file://./../../../../data/contracts/render/render.types.ck#L97)
 */
export const ScriptRatingInput = z.strictObject({
    rating: ScriptRating,
});
export type ScriptRatingInput = z.infer<typeof ScriptRatingInput>;

/**
 * What each presenter has written lately, and over how long
 * generated from [ScriptHistorySummary](file://./../../../../data/contracts/render/render.types.ck#L132)
 */
export const ScriptHistorySummary = z.strictObject({
    hours: z.coerce.number().int().min(1).max(168).describe('The window actually counted, echoed so a console can label the numbers it draws'),
    rows: z.array(ScriptHistorySummaryRow),
});
export type ScriptHistorySummary = z.infer<typeof ScriptHistorySummary>;

/**
 * The station's lexicon, oldest first
 * generated from [PronunciationList](file://./../../../../data/contracts/render/render.types.ck#L156)
 */
export const PronunciationList = z.strictObject({
    pronunciations: z.array(Pronunciation),
});
export type PronunciationList = z.infer<typeof PronunciationList>;

/**
 * Every sound the station holds, and the sets over it
 * generated from [PadList](file://./../../../../data/contracts/render/render.types.ck#L216)
 */
export const PadList = z.strictObject({
    pads: z.array(Pad),
    sets: z.array(PadSet),
});
export type PadList = z.infer<typeof PadList>;

export const PadListInput = z.strictObject({
    pads: z.array(PadInput),
    sets: z.array(PadSetInput),
});
export type PadListInput = z.infer<typeof PadListInput>;

/**
 * generated from [ScriptHistoryPage](file://./../../../../data/contracts/render/render.types.ck#L111)
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

export const ScriptHistoryPageInput = z.strictObject({
    attempts: z.array(ScriptAttemptInput),
    nextBefore: z
        .string()
        .min(1)
        .max(200)
        .optional()
        .describe('The cursor for the page after this one, absent once the history has been read to its end'),
});
export type ScriptHistoryPageInput = z.infer<typeof ScriptHistoryPageInput>;
