import { Decimal } from 'decimal.js';
import { DateTime } from 'luxon';

Decimal.set({ toExpNeg: -9e15, toExpPos: 9e15 });
const __dt = (v: unknown, path: string): DateTime => {
    if (typeof v !== 'string') {
        throw new TypeError(`ContractKit: expected an ISO 8601 string at '${path}', received ${typeof v}.`);
    }
    const d = DateTime.fromISO(v);
    if (!d.isValid) throw new TypeError(`ContractKit: '${v}' at '${path}' is not a valid ISO 8601 datetime.`);
    return d;
};

/**
 * One thing the station can play that is not a record
 * generated from [Segment](../../../../../apps/api/data/contracts/render/render.types.ck#L7)
 */
export interface Segment {
    id: string;
    /** What sort of element it is: `ident`, `stinger`, `talkbreak`, `news` */
    kind: string;
    /** One state per stage of making it. Only `ready` can go on air; the station skips anything else rather than waiting for it */
    state: 'planned' | 'writing' | 'written' | 'rendering' | 'ready' | 'failed';
    /** What the console calls it, and what the mount is labelled with while it airs */
    label: string;
    /** Who made it: `library` for a file dropped into the inbox */
    source: string;
    /** Whether there is audio behind it yet */
    playable: boolean;
    /** The words, for anything that speaks. Absent for an imported recording */
    script?: string;
    /** The words as the speech engine was handed them: symbols said, years read as a person reads them, the station's pronunciation list applied. Absent until something has spoken it */
    spokenScript?: string;
    /** The file in the inbox this came from. The bytes were copied, so emptying the inbox does not take it off the air */
    sourcePath?: string;
    /** How long it runs. A display value: the player measures the audio itself */
    durationMs?: number;
    /** Why it is `failed` */
    error?: string;
    /** The station's own name for the voice this is said in, e.g. `host`. Absent means the speech plugin's default */
    voice?: string;
    /** How the words are read: `hushed` or `frantic`. Absent is the voice's own ordinary reading, which is nearly every segment */
    delivery?: string;
}

/**
 * Something for the station to say, before anything has said it
 * generated from [SegmentCreate](../../../../../apps/api/data/contracts/render/render.types.ck#L23)
 */
export interface SegmentCreate {
    /** What the console calls it, and what the mount is labelled with while it airs */
    label: string;
    /** The words to say */
    script: string;
    /** What sort of element it is. Defaults to `talkbreak` */
    kind?: string;
    /** A station voice name the speech plugin knows how to map. Absent uses its default */
    voice?: string;
    /** How to read the words: `hushed` or `frantic`, and refused otherwise. Absent is the voice's own ordinary reading. Dropped at render time by an engine that cannot perform it */
    delivery?: string;
}

/**
 * A recording arriving from the browser, as multipart form parts.
 *
 * Documentation rather than validation: a multipart body reaches the service as the raw parser and
 * the generated client types the body as `FormData`, so nothing checks this shape. It says what to
 * send
 * generated from [SegmentUpload](../../../../../apps/api/data/contracts/render/render.types.ck#L36)
 */
export interface SegmentUpload {
    /** The audio itself. mp3, wav, ogg, flac or m4a, and at most 50 MB */
    file: Blob;
    /** What sort of element it is, which is also the directory it is filed under. A kind nothing else uses becomes a bookable band on the format clock */
    kind: string;
    /** What the console calls it, and what the mount is labelled with while it airs. Derived from the filename when absent */
    label?: string;
}

/**
 * A voice the station can be asked to speak in
 * generated from [Voice](../../../../../apps/api/data/contracts/render/render.types.ck#L46)
 */
export interface Voice {
    /** What to pass as a segment's `voice`. Empty means the plugin's own default */
    id: string;
    /** What the console calls it */
    label: string;
    /** What it sounds like, or what it maps to on the engine */
    description?: string;
}

/**
 * Whether there are words, and if not, which way it went wrong
 * generated from [ScriptOutcome](../../../../../apps/api/data/contracts/render/render.types.ck#L59)
 */
export type ScriptOutcome = 'written' | 'declined' | 'failed';

/**
 * A record a writer was told about, kept as it was told
 * generated from [ScriptNeighbour](../../../../../apps/api/data/contracts/render/render.types.ck#L61)
 */
export interface ScriptNeighbour {
    title: string;
    artist: string;
    /** What it was shown about the record. A break that said nothing interesting and one that was TOLD nothing interesting read the same from the script alone */
    facts?: string[];
}

/**
 * What the provider said the attempt cost, when it said anything
 * generated from [ScriptUsage](../../../../../apps/api/data/contracts/render/render.types.ck#L67)
 */
export interface ScriptUsage {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
}

/**
 * One turn of the conversation a writer sent
 * generated from [ScriptPromptMessage](../../../../../apps/api/data/contracts/render/render.types.ck#L73)
 */
export interface ScriptPromptMessage {
    role: string;
    content: string;
}

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
 * generated from [ScriptRating](../../../../../apps/api/data/contracts/render/render.types.ck#L110)
 */
export type ScriptRating = 'liked' | 'neutral' | 'disliked';

/**
 * Words to hear before anything has aired them
 * generated from [SpeechPreviewRequest](../../../../../apps/api/data/contracts/render/render.types.ck#L131)
 */
export interface SpeechPreviewRequest {
    /** What to say. Far under a segment's 20000 because this is one break heard once, and the cap is what bounds a cache keyed on the words themselves */
    text: string;
    /** A station voice name, as a segment's `voice`. Absent uses the plugin's own default */
    voice?: string;
    /** How to read it, as a segment's `delivery`: `hushed` or `frantic`, and refused otherwise. Absent is the voice's own ordinary reading */
    delivery?: string;
}

/**
 * The window the counts cover
 * generated from [ScriptHistorySummaryQuery](../../../../../apps/api/data/contracts/render/render.types.ck#L138)
 */
export interface ScriptHistorySummaryQuery {
    /** How far back to count. Defaults to 24, and a week at most, because past that the nightly sweep may already have taken the rows and the count would quietly be of what survived rather than of what happened */
    hours?: number;
}

/**
 * One presenter's attempts in the window
 * generated from [ScriptHistorySummaryRow](../../../../../apps/api/data/contracts/render/render.types.ck#L142)
 */
export interface ScriptHistorySummaryRow {
    /** Absent means nobody was presenting, which is an ordinary state rather than a gap in the data */
    personaKey?: string;
    written: number;
    /** A decline is the writer registry working: the model had nothing to say and the floor covered for it */
    declined: number;
    failed: number;
}

/**
 * What one pass over the inbox did
 * generated from [SegmentScanResult](../../../../../apps/api/data/contracts/render/render.types.ck#L154)
 */
export interface SegmentScanResult {
    /** Audio files seen, whether or not they were already known */
    scanned: number;
    /** Segments the station did not have before this pass */
    imported: number;
    /** Files passed over: not audio it can serve, or unreadable */
    skipped: number;
}

/**
 * One name the station says differently from how it is written
 * generated from [Pronunciation](../../../../../apps/api/data/contracts/render/render.types.ck#L160)
 */
export interface Pronunciation {
    id: string;
    /** What appears in a script. Matched case-insensitively, and whole words only */
    written: string;
    /** What the engine is handed instead, untouched. EMPTY is meaningful: it drops the words, which is the honest reading for a marker that got into a title and is not a word */
    spoken: string;
    /** `active` is said. `suggested` is proposed and says nothing yet. `rejected` outlives the pass that proposed it, or the same article proposes it again forever */
    state: 'active' | 'suggested' | 'rejected';
    /** Who says so. `gloss` is a pronunciation key an encyclopaedia article printed for itself */
    origin: 'operator' | 'gloss';
    /** The article. Present on anything an operator did not type */
    sourceUrl?: string;
    /** The sentence that says so, as it stands in the article, which is what the decision is actually made on */
    sourceQuote?: string;
    /** What the article was about */
    subjectKind?: 'track' | 'album' | 'artist';
    subjectId?: string;
    createdAt: string;
}

/**
 * A name and how to say it
 * generated from [PronunciationWrite](../../../../../apps/api/data/contracts/render/render.types.ck#L177)
 */
export interface PronunciationWrite {
    written: string;
    /** Empty drops the words rather than saying them */
    spoken: string;
}

/**
 * Accepting a proposal, turning one down, or taking an entry out of use without losing it
 * generated from [PronunciationStateWrite](../../../../../apps/api/data/contracts/render/render.types.ck#L182)
 */
export interface PronunciationStateWrite {
    state: 'active' | 'suggested' | 'rejected';
}

/**
 * Which part of the lexicon to read
 * generated from [PronunciationQuery](../../../../../apps/api/data/contracts/render/render.types.ck#L186)
 */
export interface PronunciationQuery {
    /** Absent is all of it */
    state?: 'active' | 'suggested' | 'rejected';
}

/**
 * One sound on a soundboard, as the console draws it.
 *
 * `name` is what a script writes to hit it and `label` is what a person reads: two columns rather
 * than one, because a token for a model and prose for an operator are different things and the
 * filename produces both
 * generated from [Pad](../../../../../apps/api/data/contracts/render/render.types.ck#L195)
 */
export interface Pad {
    id: string;
    /** Which directory it arrived in. Provenance: what reaches it is a set */
    board: string;
    /** The keys of the sets it is on. Empty means it is in the library and nothing can hit it */
    sets: string[];
    /** What a script writes: `[sfx:airhorn]` */
    name: string;
    label: string;
    durationMs?: number;
    /** How loud it came out, once something measured it. Absent on a station with no analyzer, which is ordinary */
    loudnessLufs?: number;
    /** Who put the file there: `library` for one the operator dropped in, `upload` or `url` for one the console wrote. It decides whether the console may delete it */
    source: string;
    /** The file in the library directory it was imported from, so the console can say where it came from */
    sourcePath?: string;
    /** When it was last hit. Absent for one nothing has reached for yet */
    lastUsedAt?: DateTime;
    state: 'active' | 'rejected';
}

export interface PadInput {
    /** Which directory it arrived in. Provenance: what reaches it is a set */
    board: string;
    /** What a script writes: `[sfx:airhorn]` */
    name: string;
    label: string;
    durationMs?: number;
    /** How loud it came out, once something measured it. Absent on a station with no analyzer, which is ordinary */
    loudnessLufs?: number;
    /** The file in the library directory it was imported from, so the console can say where it came from */
    sourcePath?: string;
    /** When it was last hit. Absent for one nothing has reached for yet */
    lastUsedAt?: DateTime;
    state: 'active' | 'rejected';
}

/** Rehydrates every wire-encoded scalar in a Pad into its runtime type. Mutates and returns `raw`. */
export function revivePad(raw: Pad): Pad {
    const __o0 = raw as unknown as Record<string, unknown>;
    if (__o0['lastUsedAt'] != null) {
        __o0['lastUsedAt'] = __dt(__o0['lastUsedAt'], 'Pad.lastUsedAt');
    }
    return raw;
}

/**
 * A sound arriving from the browser, as multipart form parts.
 *
 * Documentation rather than validation: a multipart body reaches the service as the raw parser and
 * the generated client types the body as `FormData`, so nothing checks this shape. It says what to
 * send
 * generated from [PadUpload](../../../../../apps/api/data/contracts/render/render.types.ck#L214)
 */
export interface PadUpload {
    /** The audio itself. mp3, wav, ogg, flac or m4a, and at most 25 MB */
    file: Blob;
    /** The directory it is filed under, which is also the set it joins. A new name makes both */
    board: string;
    /** What a script will write. Derived from the filename when absent, and the FILE is named after this either way */
    name?: string;
    /** What the console calls it. Derived from the filename when absent */
    label?: string;
}

/**
 * A sound the station is being told to go and get.
 *
 * The operator names the address, so this is them choosing a file exactly as dropping one in the
 * library is. Nothing inspects what comes back and nothing records a claim about its licence -- see
 * `docs/internals/render.md` under "Pads", whose line is redistribution rather than use
 * generated from [PadFetch](../../../../../apps/api/data/contracts/render/render.types.ck#L226)
 */
export interface PadFetch {
    /** Where the audio is. Followed once, bounded, and refused unless what comes back is a format the station serves */
    url: string;
    /** The directory it is filed under, which is also the set it joins */
    board: string;
    /** What a script will write. Derived from the address when absent */
    name?: string;
    label?: string;
}

/**
 * A named collection of pads: what a presenter is actually handed.
 *
 * One library, cut as many ways as an operator likes. `personas.soundboard` holds the `key`, so
 * renaming a set unpoints every persona naming it — which is why `personas` says who those are
 * generated from [PadSet](../../../../../apps/api/data/contracts/render/render.types.ck#L242)
 */
export interface PadSet {
    id: string;
    /** The slug a persona names. A directory in the pad library makes one of these */
    key: string;
    label: string;
    position: number;
    /** How many sounds are on it. Zero is ordinary: it is what a set looks like before anybody drops a file */
    pads: number;
    /** Who is pointed at it, so a rename or a delete can say what it is about to unpoint */
    personas: string[];
}

export interface PadSetInput {
    /** The slug a persona names. A directory in the pad library makes one of these */
    key: string;
    label: string;
    position: number;
}

/**
 * A set an operator is naming, or renaming
 * generated from [PadSetWrite](../../../../../apps/api/data/contracts/render/render.types.ck#L251)
 */
export interface PadSetWrite {
    key: string;
    label: string;
    position?: number;
}

/**
 * Which pad, and whether it is on the set
 * generated from [PadSetMembership](../../../../../apps/api/data/contracts/render/render.types.ck#L257)
 */
export interface PadSetMembership {
    padId: string;
    on: boolean;
}

/**
 * Turning a pad down, or putting one back
 * generated from [PadState](../../../../../apps/api/data/contracts/render/render.types.ck#L262)
 */
export interface PadState {
    state: 'active' | 'rejected';
}

/**
 * What one pass over the pad library did
 * generated from [PadScanResult](../../../../../apps/api/data/contracts/render/render.types.ck#L266)
 */
export interface PadScanResult {
    /** Audio files seen, whether or not anything changed */
    scanned: number;
    /** Sounds the station did not have before */
    imported: number;
    /** Slots whose file changed under them, which every script naming them now plays */
    replaced: number;
    /** Sounds that reached the library but not their set, because it already answered to their name. In the library and unreachable until somebody says where they go */
    contested: number;
    /** Files passed over: not audio, unreadable, or named something no script could write */
    skipped: number;
}

/**
 * Everything the station can play that is not a record
 * generated from [SegmentList](../../../../../apps/api/data/contracts/render/render.types.ck#L42)
 */
export interface SegmentList {
    segments: Segment[];
}

/**
 * The voices the station's current speech plugin offers
 * generated from [VoiceList](../../../../../apps/api/data/contracts/render/render.types.ck#L52)
 */
export interface VoiceList {
    voices: Voice[];
    /** Which plugin answered. Absent when nothing can speak */
    pluginId?: string;
    /** Why there are no voices, when there are none */
    reason?: string;
    /** Which readings that plugin can perform right now, out of `hushed` and `frantic`. Absent or empty means none, which is most engines and is not a fault */
    deliveries?: string[];
}

/**
 * One page of what the station has written, newest first
 * generated from [ScriptHistoryQuery](../../../../../apps/api/data/contracts/render/render.types.ck#L116)
 */
export interface ScriptHistoryQuery {
    limit?: number;
    /** Where the previous page ended. Opaque, and a keyset rather than an offset because rows arrive at the head continuously. Pass back whatever `nextBefore` said and nothing else */
    before?: string;
    kind?: string;
    writer?: string;
    outcome?: ScriptOutcome;
    /** Everything ONE character has said. Absent is every character and none */
    personaKey?: string;
    /** Every attempt made for ONE break, which is how a console reaches the words behind an item of the running order. Absent is the whole history */
    segmentId?: string;
}

/**
 * One attempt to write something the station would say, including the ones that came to nothing
 * generated from [ScriptAttempt](../../../../../apps/api/data/contracts/render/render.types.ck#L78)
 */
export interface ScriptAttempt {
    id: string;
    at: DateTime;
    /** What sort of break it was for: `talkbreak`, `welcome`, `news` */
    kind: string;
    /** The binding that produced or declined it */
    writer: string;
    outcome: ScriptOutcome;
    /** Who was presenting, as the persona's own key. Absent means nobody was, which is an ordinary state. Stamped on every attempt including the declined ones, so a character whose model breaks are all being refused is visible rather than hidden behind the floor */
    personaKey?: string;
    label?: string;
    /** The words. Absent for an attempt that produced none */
    script?: string;
    /** How the writer chose to have the words read, `hushed` or `frantic`. Absent for an ordinary reading */
    delivery?: string;
    /** The model that said it, for a writer that used one */
    model?: string;
    /** What the line was rendered from, for a writer working from something an operator can edit */
    source?: string;
    /** Why, for anything that is not `written` */
    reason?: string;
    /** The segment this was for, while it is still known. The row outlives it */
    segmentId?: string;
    previous?: ScriptNeighbour;
    next?: ScriptNeighbour;
    /** How long the attempt took */
    durationMs?: number;
    usage?: ScriptUsage;
    /** The answer before anything read it. Only while `llm.captureWrites` is on */
    raw?: string;
    /** What the writer sent. Only while `llm.captureWrites` is on */
    prompt?: ScriptPromptMessage[];
    /** What the operator thought of it. ABSENT means nobody has said, which `neutral` does not */
    rating?: ScriptRating;
}

export interface ScriptAttemptInput {
    id: string;
    at: DateTime;
    /** What sort of break it was for: `talkbreak`, `welcome`, `news` */
    kind: string;
    /** The binding that produced or declined it */
    writer: string;
    outcome: ScriptOutcome;
    /** Who was presenting, as the persona's own key. Absent means nobody was, which is an ordinary state. Stamped on every attempt including the declined ones, so a character whose model breaks are all being refused is visible rather than hidden behind the floor */
    personaKey?: string;
    label?: string;
    /** The words. Absent for an attempt that produced none */
    script?: string;
    /** How the writer chose to have the words read, `hushed` or `frantic`. Absent for an ordinary reading */
    delivery?: string;
    /** The model that said it, for a writer that used one */
    model?: string;
    /** What the line was rendered from, for a writer working from something an operator can edit */
    source?: string;
    /** Why, for anything that is not `written` */
    reason?: string;
    /** The segment this was for, while it is still known. The row outlives it */
    segmentId?: string;
    previous?: ScriptNeighbour;
    next?: ScriptNeighbour;
    /** How long the attempt took */
    durationMs?: number;
    usage?: ScriptUsage;
    /** The answer before anything read it. Only while `llm.captureWrites` is on */
    raw?: string;
    /** What the writer sent. Only while `llm.captureWrites` is on */
    prompt?: ScriptPromptMessage[];
}

/** Rehydrates every wire-encoded scalar in a ScriptAttempt into its runtime type. Mutates and returns `raw`. */
export function reviveScriptAttempt(raw: ScriptAttempt): ScriptAttempt {
    const __o0 = raw as unknown as Record<string, unknown>;
    __o0['at'] = __dt(__o0['at'], 'ScriptAttempt.at');
    return raw;
}

/**
 * generated from [ScriptRatingInput](../../../../../apps/api/data/contracts/render/render.types.ck#L112)
 */
export interface ScriptRatingInput {
    rating: ScriptRating;
}

/**
 * What each presenter has written lately, and over how long
 * generated from [ScriptHistorySummary](../../../../../apps/api/data/contracts/render/render.types.ck#L149)
 */
export interface ScriptHistorySummary {
    /** The window actually counted, echoed so a console can label the numbers it draws */
    hours: number;
    rows: ScriptHistorySummaryRow[];
}

/**
 * The station's lexicon, oldest first
 * generated from [PronunciationList](../../../../../apps/api/data/contracts/render/render.types.ck#L173)
 */
export interface PronunciationList {
    pronunciations: Pronunciation[];
}

/**
 * Every sound the station holds, and the sets over it
 * generated from [PadList](../../../../../apps/api/data/contracts/render/render.types.ck#L233)
 */
export interface PadList {
    pads: Pad[];
    sets: PadSet[];
}

export interface PadListInput {
    pads: PadInput[];
    sets: PadSetInput[];
}

/** Rehydrates every wire-encoded scalar in a PadList into its runtime type. Mutates and returns `raw`. */
export function revivePadList(raw: PadList): PadList {
    const __o0 = raw as unknown as Record<string, unknown>;
    {
        const __a1 = __o0['pads'] as unknown[];
        for (let __i2 = 0; __i2 < __a1.length; __i2++) {
            revivePad(__a1[__i2] as never);
        }
    }
    return raw;
}

/**
 * generated from [ScriptHistoryPage](../../../../../apps/api/data/contracts/render/render.types.ck#L126)
 */
export interface ScriptHistoryPage {
    attempts: ScriptAttempt[];
    /** The cursor for the page after this one, absent once the history has been read to its end */
    nextBefore?: string;
}

export interface ScriptHistoryPageInput {
    attempts: ScriptAttemptInput[];
    /** The cursor for the page after this one, absent once the history has been read to its end */
    nextBefore?: string;
}

/** Rehydrates every wire-encoded scalar in a ScriptHistoryPage into its runtime type. Mutates and returns `raw`. */
export function reviveScriptHistoryPage(raw: ScriptHistoryPage): ScriptHistoryPage {
    const __o0 = raw as unknown as Record<string, unknown>;
    {
        const __a1 = __o0['attempts'] as unknown[];
        for (let __i2 = 0; __i2 < __a1.length; __i2++) {
            reviveScriptAttempt(__a1[__i2] as never);
        }
    }
    return raw;
}
