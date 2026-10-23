import { DateTime } from 'luxon';
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
 * generated from [HistoryEntry](../../../../../apps/api/data/contracts/history/history.types.ck)
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
 * generated from [HistoryQuery](../../../../../apps/api/data/contracts/history/history.types.ck)
 */
export interface HistoryQuery {
    limit?: number;
    /** Where the previous page ended. Opaque, and a keyset rather than an offset because rows arrive at the head continuously: an offset would re-show a row on every page as the station kept playing under it. Pass back whatever `nextBefore` said and nothing else */
    before?: string;
}

/**
 * What one line of the as-run log is.
 *
 *   record, break, programme   something that went out, with when it started and, once the station saw it end, when it ended
 *   gap                        the station aired its local bed instead of the running order. Only gaps long enough to matter are recorded
 *   onAir, offAir              the station was put on air, or stood down
 * generated from [AsRunKind](../../../../../apps/api/data/contracts/history/history.types.ck)
 */
export type AsRunKind = 'record' | 'break' | 'programme' | 'gap' | 'onAir' | 'offAir';

/**
 * One page of the as-run log, newest first
 * generated from [AsRunQuery](../../../../../apps/api/data/contracts/history/history.types.ck)
 */
export interface AsRunQuery {
    limit?: number;
    /** Where the previous page ended. Opaque: pass back whatever `nextBefore` said */
    before?: string;
    /** Start reading from this moment back, to jump to an hour without paging to it. Ignored when `before` is sent */
    until?: DateTime;
}

/** Rehydrates every wire-encoded scalar in a AsRunQuery into its runtime type. Mutates and returns `raw`. */
export function reviveAsRunQuery(raw: AsRunQuery): AsRunQuery {
    const __o0 = raw as unknown as Record<string, unknown>;
    if (__o0['until'] != null) {
        __o0['until'] = __dt(__o0['until'], 'AsRunQuery.until');
    }
    return raw;
}

/**
 * generated from [HistoryPage](../../../../../apps/api/data/contracts/history/history.types.ck)
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

/**
 * One line of what actually went out
 * generated from [AsRunEntry](../../../../../apps/api/data/contracts/history/history.types.ck)
 */
export interface AsRunEntry {
    /** Unique across the log, and half of the cursor below */
    id: string;
    kind: AsRunKind;
    /** When it started. For an item, the moment the player said so, not when it was handed over */
    at: DateTime;
    /** When it stopped. Absent while an item is on air, and for one the station never saw end, such as the last item before a crash */
    endedAt?: DateTime;
    /** A record's title or a break's label, as it went out */
    title?: string;
    /** A record's credit as written, whole */
    artists?: string;
    /** The catalog track a record was */
    trackId?: string;
    /** The segment a break or a programme was */
    segmentId?: string;
    /** How many items already handed to the player it moved past to reach this one. They never aired. Absent when none */
    passedOver?: number;
    /** For a gap or an air change, the station's own sentence about it */
    detail?: string;
}

/** Rehydrates every wire-encoded scalar in a AsRunEntry into its runtime type. Mutates and returns `raw`. */
export function reviveAsRunEntry(raw: AsRunEntry): AsRunEntry {
    const __o0 = raw as unknown as Record<string, unknown>;
    __o0['at'] = __dt(__o0['at'], 'AsRunEntry.at');
    if (__o0['endedAt'] != null) {
        __o0['endedAt'] = __dt(__o0['endedAt'], 'AsRunEntry.endedAt');
    }
    return raw;
}

/**
 * generated from [AsRunPage](../../../../../apps/api/data/contracts/history/history.types.ck)
 */
export interface AsRunPage {
    entries: AsRunEntry[];
    /** The cursor for the page after this one, absent once the log has been read to its end */
    nextBefore?: string;
}

/** Rehydrates every wire-encoded scalar in a AsRunPage into its runtime type. Mutates and returns `raw`. */
export function reviveAsRunPage(raw: AsRunPage): AsRunPage {
    const __o0 = raw as unknown as Record<string, unknown>;
    {
        const __a1 = __o0['entries'] as unknown[];
        for (let __i2 = 0; __i2 < __a1.length; __i2++) {
            reviveAsRunEntry(__a1[__i2] as never);
        }
    }
    return raw;
}
