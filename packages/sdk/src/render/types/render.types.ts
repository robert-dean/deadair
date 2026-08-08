/**
 * One thing the station can play that is not a record
 * generated from [Segment](file://./../../../../../apps/api/data/contracts/render/render.types.ck#L7)
 */
export interface Segment {
    id: string;
    /** What sort of element it is: `ident`, `stinger`, `talkbreak`, `news` */
    kind: string;
    /** Only `ready` can go on air. The station skips anything else rather than waiting for it */
    state: 'planned' | 'rendering' | 'ready' | 'failed';
    /** What the console calls it, and what the mount is labelled with while it airs */
    label: string;
    /** Who made it: `library` for a file dropped into the inbox */
    source: string;
    /** Whether there is audio behind it yet */
    playable: boolean;
    /** The words, for anything that speaks. Absent for an imported recording */
    script?: string;
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
 * generated from [SegmentCreate](file://./../../../../../apps/api/data/contracts/render/render.types.ck#L21)
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
 * generated from [Voice](file://./../../../../../apps/api/data/contracts/render/render.types.ck#L32)
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
 * What one pass over the inbox did
 * generated from [SegmentScanResult](file://./../../../../../apps/api/data/contracts/render/render.types.ck#L44)
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
 * generated from [SegmentList](file://./../../../../../apps/api/data/contracts/render/render.types.ck#L28)
 */
export interface SegmentList {
    segments: Segment[];
}

/**
 * The voices the station's current speech plugin offers
 * generated from [VoiceList](file://./../../../../../apps/api/data/contracts/render/render.types.ck#L38)
 */
export interface VoiceList {
    voices: Voice[];
    /** Which plugin answered. Absent when nothing can speak */
    pluginId?: string;
    /** Why there are no voices, when there are none */
    reason?: string;
}
