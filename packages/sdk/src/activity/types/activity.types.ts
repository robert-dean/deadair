/**
 * Which part of the station an entry came from, and the console's one filter axis
 * generated from [ActivityModule](file://./../../../../../apps/api/data/contracts/activity/activity.types.ck#L8)
 */
export type ActivityModule = 'playout' | 'director' | 'render' | 'catalog' | 'plugins';

/**
 * How an entry reads, not how bad it is. There is deliberately no `waiting`: a station idling for
 * want of a listener says so in its own words and stays `info`, for the same reason the transport
 * reports it as `ready` rather than as a mild fault
 * generated from [ActivitySeverity](file://./../../../../../apps/api/data/contracts/activity/activity.types.ck#L13)
 */
export type ActivitySeverity = 'info' | 'warn' | 'fault';

/**
 * One thing that happened, from whichever of the feed's sources holds it
 * generated from [ActivityEntry](file://./../../../../../apps/api/data/contracts/activity/activity.types.ck#L15)
 */
export interface ActivityEntry {
    /** Unique across the whole feed, and half of the cursor below */
    id: string;
    /** When it happened, as the database recorded it */
    at: string;
    module: ActivityModule;
    /** Dotted and stable: `silence.cause`, `air.on`, `segment.ready`, `track.aired`. What a console draws a line with, never something a decision is made on */
    kind: string;
    severity: ActivitySeverity;
    /** The sentence a person reads, phrased by whatever produced it */
    detail: string;
    /** The structured half, for a reader that wants to filter or chart rather than read */
    data?: Record<string, unknown>;
    /** The segment this is about, for an entry that came from one */
    segmentId?: string;
    /** The catalog track this is about, for an entry that came from one */
    trackId?: string;
}

/**
 * One page of the feed, newest first
 * generated from [ActivityQuery](file://./../../../../../apps/api/data/contracts/activity/activity.types.ck#L27)
 */
export interface ActivityQuery {
    limit?: number;
    /** Where the previous page ended. Opaque, and a keyset rather than an offset because rows arrive at the head continuously: an offset would re-show a row on every page as the feed grew under it. Pass back whatever `nextBefore` said and nothing else */
    before?: string;
    module?: ActivityModule;
    /** The floor, not the exact match: `warn` answers with warnings and faults. Absent is everything */
    minSeverity?: ActivitySeverity;
}

/**
 * generated from [ActivityPage](file://./../../../../../apps/api/data/contracts/activity/activity.types.ck#L34)
 */
export interface ActivityPage {
    entries: ActivityEntry[];
    /** The cursor for the page after this one, absent once the feed has been read to its end */
    nextBefore?: string;
}
