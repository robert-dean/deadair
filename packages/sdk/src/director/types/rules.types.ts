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
 * A never-play rule: a KIND of record the station must not play. Absolute, like a dislike, and
 * exclude-only: there is no "only these" rule, because one could leave the station nothing to play.
 * Every scope is optional and an absent one means "always"
 * generated from [BlockRule](../../../../../apps/api/data/contracts/director/rules.types.ck)
 */
export interface BlockRule {
    id: string;
    /** `genre` refuses any record tagged with this genre or a kind of it (`Punk Rock` under `Punk`, never `Pop` under `Pop Punk`, never `Trap` under `Rap`). `tag` refuses a record carrying exactly this tag */
    field: 'genre' | 'tag';
    /** The genre or tag, as you would write it */
    value: string;
    /** First day it holds, as `MM-DD`. With `seasonTo`; a season starting after it ends wraps the year end */
    seasonFrom?: string;
    /** Last day it holds, as `MM-DD` */
    seasonTo?: string;
    /** First hour of the station's day it holds. With `untilHour`; a window starting after it ends wraps midnight */
    fromHour?: number;
    /** The hour it stops holding, exclusive */
    untilHour?: number;
    /** Only while the station is in one of these modes. Absent or empty means every mode */
    modes?: ('rotation' | 'setlist' | 'feature')[];
    /** Only during these schedule blocks. Absent or empty means whatever is on */
    slotIds?: string[];
    /** When it stops holding. Absent means until it is removed */
    endsAt?: DateTime;
    /** Whether it holds right now, on the station's clock, for what is on air */
    inForce: boolean;
}

export interface BlockRuleInput {
    /** `genre` refuses any record tagged with this genre or a kind of it (`Punk Rock` under `Punk`, never `Pop` under `Pop Punk`, never `Trap` under `Rap`). `tag` refuses a record carrying exactly this tag */
    field: 'genre' | 'tag';
    /** The genre or tag, as you would write it */
    value: string;
    /** First day it holds, as `MM-DD`. With `seasonTo`; a season starting after it ends wraps the year end */
    seasonFrom?: string;
    /** Last day it holds, as `MM-DD` */
    seasonTo?: string;
    /** First hour of the station's day it holds. With `untilHour`; a window starting after it ends wraps midnight */
    fromHour?: number;
    /** The hour it stops holding, exclusive */
    untilHour?: number;
    /** Only while the station is in one of these modes. Absent or empty means every mode */
    modes?: ('rotation' | 'setlist' | 'feature')[];
    /** Only during these schedule blocks. Absent or empty means whatever is on */
    slotIds?: string[];
    /** When it stops holding. Absent means until it is removed */
    endsAt?: DateTime;
}

/** Rehydrates every wire-encoded scalar in a BlockRule into its runtime type. Mutates and returns `raw`. */
export function reviveBlockRule(raw: BlockRule): BlockRule {
    const __o0 = raw as unknown as Record<string, unknown>;
    if (__o0['endsAt'] != null) {
        __o0['endsAt'] = __dt(__o0['endsAt'], 'BlockRule.endsAt');
    }
    return raw;
}

/**
 * A lean toward some genres for a while. The opposite of a rule: the station favours them when it
 * chooses records, and still plays anything else rather than run dry
 * generated from [GenreSteer](../../../../../apps/api/data/contracts/director/rules.types.ck)
 */
export interface GenreSteer {
    /** What to favour, as genres. A record tagged with any of them, or a kind of one, is preferred */
    genres: string[];
    /** When the station goes back to choosing as it ordinarily does */
    endsAt: DateTime;
}

/** Rehydrates every wire-encoded scalar in a GenreSteer into its runtime type. Mutates and returns `raw`. */
export function reviveGenreSteer(raw: GenreSteer): GenreSteer {
    const __o0 = raw as unknown as Record<string, unknown>;
    __o0['endsAt'] = __dt(__o0['endsAt'], 'GenreSteer.endsAt');
    return raw;
}

/**
 * Lean the station toward some genres for a number of hours
 * generated from [GenreSteerInput](../../../../../apps/api/data/contracts/director/rules.types.ck)
 */
export interface GenreSteerInput {
    genres: string[];
    /** How long it lasts, from now */
    hours: number;
}

/**
 * Every rule on the station, newest first
 * generated from [BlockRuleList](../../../../../apps/api/data/contracts/director/rules.types.ck)
 */
export interface BlockRuleList {
    rules: BlockRule[];
}

export interface BlockRuleListInput {
    rules: BlockRuleInput[];
}

/** Rehydrates every wire-encoded scalar in a BlockRuleList into its runtime type. Mutates and returns `raw`. */
export function reviveBlockRuleList(raw: BlockRuleList): BlockRuleList {
    const __o0 = raw as unknown as Record<string, unknown>;
    {
        const __a1 = __o0['rules'] as unknown[];
        for (let __i2 = 0; __i2 < __a1.length; __i2++) {
            reviveBlockRule(__a1[__i2] as never);
        }
    }
    return raw;
}

/**
 * The lean in force, or none
 * generated from [GenreSteerReading](../../../../../apps/api/data/contracts/director/rules.types.ck)
 */
export interface GenreSteerReading {
    /** Absent when nothing is leaning the station, including once one has run out */
    steer?: GenreSteer;
}

/** Rehydrates every wire-encoded scalar in a GenreSteerReading into its runtime type. Mutates and returns `raw`. */
export function reviveGenreSteerReading(raw: GenreSteerReading): GenreSteerReading {
    const __o0 = raw as unknown as Record<string, unknown>;
    if (__o0['steer'] != null) {
        reviveGenreSteer(__o0['steer'] as never);
    }
    return raw;
}
