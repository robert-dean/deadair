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
 * One record the station actually played
 * generated from [HistoryEntry](../../../../../apps/api/data/contracts/history/history.types.ck#L7)
 */
export interface HistoryEntry {
    /** Unique across the history, and half of the cursor below */
    id: string;
    /** When it started, written when it began rather than when it was handed to the player */
    airedAt: DateTime;
    title: string;
    /** The credit as written, whole: one line rather than a list, because that is the shape a release credits itself in and splitting it renames acts with a comma in their name */
    artists: string;
    /** Absent for anything aired straight from a provider, which the catalog holds no record for */
    album?: string;
    /** The station's own copy where it has one, as a path under the API root, and the upstream URL until then. Resolve it against the base the station is reached at */
    artworkUrl?: string;
    /** How long the recording runs, from the catalog rather than from the copy that played */
    durationMs?: number;
    /** The catalog track this was, for a client that wants to ask more about it. Absent for a record the catalog does not hold, and for one it has since forgotten */
    trackId?: string;
}

/** Rehydrates every wire-encoded scalar in a HistoryEntry into its runtime type. Mutates and returns `raw`. */
export function reviveHistoryEntry(raw: HistoryEntry): HistoryEntry {
    const __o0 = raw as unknown as Record<string, unknown>;
    __o0['airedAt'] = __dt(__o0['airedAt'], 'HistoryEntry.airedAt');
    return raw;
}

/**
 * One page of the history, newest first
 * generated from [HistoryQuery](../../../../../apps/api/data/contracts/history/history.types.ck#L18)
 */
export interface HistoryQuery {
    limit?: number;
    /** Where the previous page ended. Opaque, and a keyset rather than an offset because rows arrive at the head continuously: an offset would re-show a row on every page as the station kept playing under it. Pass back whatever `nextBefore` said and nothing else */
    before?: string;
}

/**
 * generated from [HistoryPage](../../../../../apps/api/data/contracts/history/history.types.ck#L23)
 */
export interface HistoryPage {
    entries: HistoryEntry[];
    /** The cursor for the page after this one, absent once the history has been read to its end */
    nextBefore?: string;
}

/** Rehydrates every wire-encoded scalar in a HistoryPage into its runtime type. Mutates and returns `raw`. */
export function reviveHistoryPage(raw: HistoryPage): HistoryPage {
    const __o0 = raw as unknown as Record<string, unknown>;
    {
        const __a1 = __o0['entries'] as unknown[];
        for (let __i2 = 0; __i2 < __a1.length; __i2++) {
            reviveHistoryEntry(__a1[__i2] as never);
        }
    }
    return raw;
}
