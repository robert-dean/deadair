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
}

/**
 * What one pass over the inbox did
 * generated from [SegmentScanResult](file://./../../../../../apps/api/data/contracts/render/render.types.ck#L24)
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
 * generated from [SegmentList](file://./../../../../../apps/api/data/contracts/render/render.types.ck#L20)
 */
export interface SegmentList {
    segments: Segment[];
}
