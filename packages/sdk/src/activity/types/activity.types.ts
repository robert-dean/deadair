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
 * Which part of the station an entry came from, and the console's one filter axis
 * generated from [ActivityModule](../../../../../apps/api/data/contracts/activity/activity.types.ck#L8)
 */
export type ActivityModule = 'playout' | 'director' | 'render' | 'catalog' | 'plugins';

/**
 * How an entry reads, not how bad it is. There is deliberately no `waiting`: a station idling for
 * want of a listener says so in its own words and stays `info`, for the same reason the transport
 * reports it as `ready` rather than as a mild fault
 * generated from [ActivitySeverity](../../../../../apps/api/data/contracts/activity/activity.types.ck#L13)
 */
export type ActivitySeverity = 'info' | 'warn' | 'fault';

/**
 * One thing that happened, from whichever of the feed's sources holds it
 * generated from [ActivityEntry](../../../../../apps/api/data/contracts/activity/activity.types.ck#L15)
 */
export interface ActivityEntry {
    /** Unique across the whole feed, and half of the cursor below */
    id: string;
    /** When it happened, as the database recorded it */
    at: DateTime;
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

/** Rehydrates every wire-encoded scalar in a ActivityEntry into its runtime type. Mutates and returns `raw`. */
export function reviveActivityEntry(raw: ActivityEntry): ActivityEntry {
    const __o0 = raw as unknown as Record<string, unknown>;
    __o0['at'] = __dt(__o0['at'], 'ActivityEntry.at');
    return raw;
}

/**
 * One page of the feed, newest first
 * generated from [ActivityQuery](../../../../../apps/api/data/contracts/activity/activity.types.ck#L27)
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
 * generated from [ActivityPage](../../../../../apps/api/data/contracts/activity/activity.types.ck#L34)
 */
export interface ActivityPage {
    entries: ActivityEntry[];
    /** The cursor for the page after this one, absent once the feed has been read to its end */
    nextBefore?: string;
}

/** Rehydrates every wire-encoded scalar in a ActivityPage into its runtime type. Mutates and returns `raw`. */
export function reviveActivityPage(raw: ActivityPage): ActivityPage {
    const __o0 = raw as unknown as Record<string, unknown>;
    {
        const __a1 = __o0['entries'] as unknown[];
        for (let __i2 = 0; __i2 < __a1.length; __i2++) {
            reviveActivityEntry(__a1[__i2] as never);
        }
    }
    return raw;
}
