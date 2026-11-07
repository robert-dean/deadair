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
 * A line the operator gives the presenters for a while. Talk breaks, banter between co-hosts and the
 * changeover into a show hear it as a lean on what they talk about, never as a fact to state or a
 * line to read out. Bulletins, the date, jingles and calls never hear it
 * generated from [TalkDirection](../../../../../apps/api/data/contracts/director/direction.types.ck)
 */
export interface TalkDirection {
    /** What the presenters are told, as the operator wrote it */
    words: string;
    /** When the presenters stop hearing it */
    endsAt: DateTime;
}

/** Rehydrates every wire-encoded scalar in a TalkDirection into its runtime type. Mutates and returns `raw`. */
export function reviveTalkDirection(raw: TalkDirection): TalkDirection {
    const __o0 = raw as unknown as Record<string, unknown>;
    __o0['endsAt'] = __dt(__o0['endsAt'], 'TalkDirection.endsAt');
    return raw;
}

/**
 * Direct the presenters for a number of hours
 * generated from [TalkDirectionInput](../../../../../apps/api/data/contracts/director/direction.types.ck)
 */
export interface TalkDirectionInput {
    /** A lean for the presenters, such as "it's Sam's birthday tonight" or "we're snowed in, keep it cosy" */
    words: string;
    /** How long it lasts, from now */
    hours: number;
}

/**
 * The direction in force, or none
 * generated from [TalkDirectionReading](../../../../../apps/api/data/contracts/director/direction.types.ck)
 */
export interface TalkDirectionReading {
    /** Absent when nothing is directing the presenters, including once a direction has run out */
    direction?: TalkDirection;
}

/** Rehydrates every wire-encoded scalar in a TalkDirectionReading into its runtime type. Mutates and returns `raw`. */
export function reviveTalkDirectionReading(raw: TalkDirectionReading): TalkDirectionReading {
    const __o0 = raw as unknown as Record<string, unknown>;
    if (__o0['direction'] != null) {
        reviveTalkDirection(__o0['direction'] as never);
    }
    return raw;
}
