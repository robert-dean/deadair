/**
 * One thing the station can play that is not a record
 * generated from [Segment](file://./../../../../../apps/api/data/contracts/render/render.types.ck#L7)
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
}

/**
 * Something for the station to say, before anything has said it
 * generated from [SegmentCreate](file://./../../../../../apps/api/data/contracts/render/render.types.ck#L22)
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
}

/**
 * A voice the station can be asked to speak in
 * generated from [Voice](file://./../../../../../apps/api/data/contracts/render/render.types.ck#L33)
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
 * generated from [ScriptOutcome](file://./../../../../../apps/api/data/contracts/render/render.types.ck#L45)
 */
export type ScriptOutcome = 'written' | 'declined' | 'failed';

/**
 * A record a writer was told about, kept as it was told
 * generated from [ScriptNeighbour](file://./../../../../../apps/api/data/contracts/render/render.types.ck#L47)
 */
export interface ScriptNeighbour {
    title: string;
    artist: string;
    /** What it was shown about the record. A break that said nothing interesting and one that was TOLD nothing interesting read the same from the script alone */
    facts?: string[];
}

/**
 * What the provider said the attempt cost, when it said anything
 * generated from [ScriptUsage](file://./../../../../../apps/api/data/contracts/render/render.types.ck#L53)
 */
export interface ScriptUsage {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
}

/**
 * One turn of the conversation a writer sent
 * generated from [ScriptPromptMessage](file://./../../../../../apps/api/data/contracts/render/render.types.ck#L59)
 */
export interface ScriptPromptMessage {
    role: string;
    content: string;
}

/**
 * What one pass over the inbox did
 * generated from [SegmentScanResult](file://./../../../../../apps/api/data/contracts/render/render.types.ck#L98)
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
 * Everything the station can play that is not a record
 * generated from [SegmentList](file://./../../../../../apps/api/data/contracts/render/render.types.ck#L29)
 */
export interface SegmentList {
    segments: Segment[];
}

/**
 * The voices the station's current speech plugin offers
 * generated from [VoiceList](file://./../../../../../apps/api/data/contracts/render/render.types.ck#L39)
 */
export interface VoiceList {
    voices: Voice[];
    /** Which plugin answered. Absent when nothing can speak */
    pluginId?: string;
    /** Why there are no voices, when there are none */
    reason?: string;
}

/**
 * One page of what the station has written, newest first
 * generated from [ScriptHistoryQuery](file://./../../../../../apps/api/data/contracts/render/render.types.ck#L84)
 */
export interface ScriptHistoryQuery {
    limit?: number;
    /** Where the previous page ended. Opaque, and a keyset rather than an offset because rows arrive at the head continuously. Pass back whatever `nextBefore` said and nothing else */
    before?: string;
    kind?: string;
    writer?: string;
    outcome?: ScriptOutcome;
    /** Every attempt made for ONE break, which is how a console reaches the words behind an item of the running order. Absent is the whole history */
    segmentId?: string;
}

/**
 * One attempt to write something the station would say, including the ones that came to nothing
 * generated from [ScriptAttempt](file://./../../../../../apps/api/data/contracts/render/render.types.ck#L64)
 */
export interface ScriptAttempt {
    id: string;
    at: string;
    /** What sort of break it was for: `talkbreak`, `welcome`, `news` */
    kind: string;
    /** The binding that produced or declined it */
    writer: string;
    outcome: ScriptOutcome;
    label?: string;
    /** The words. Absent for an attempt that produced none */
    script?: string;
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

/**
 * generated from [ScriptHistoryPage](file://./../../../../../apps/api/data/contracts/render/render.types.ck#L93)
 */
export interface ScriptHistoryPage {
    attempts: ScriptAttempt[];
    /** The cursor for the page after this one, absent once the history has been read to its end */
    nextBefore?: string;
}
