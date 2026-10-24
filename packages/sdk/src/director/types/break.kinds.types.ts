/**
 * A kind of break you write yourself: a brief in prose, and what the presenter is shown while writing one
 * generated from [BreakKind](../../../../../apps/api/data/contracts/director/break.kinds.types.ck)
 */
export interface BreakKind {
    id: string;
    /** The kind, as a band on the format clock names it: lowercase words joined by hyphens. Fixed once the kind is created, because every band and every break it ever planted carries it */
    key: string;
    /** What the console calls it. Never read out */
    name: string;
    /** What this kind of break is for and when to say nothing, written as an instruction to the presenter. The station's own rules for every break still apply on top of it */
    brief: string;
    /** Anything this kind owes beyond the rules every break owes, one per entry. Added to those rules, never in place of them */
    rules: string[];
    /** Whether the presenter is shown the record that has just finished */
    showsPrevious: boolean;
    /** Whether the presenter is shown the rest of this broadcast's records, to refer back to */
    showsPlayed: boolean;
    /** Whether the records shown carry the notes the station holds about them */
    showsFacts: boolean;
    /** Whether the presenter is shown their own notebook */
    showsNotebook: boolean;
    /** Whether the station writes this kind at all. A new or imported kind is off until you switch it on */
    enabled: boolean;
    /** Your own order, for the list */
    position: number;
}

export interface BreakKindInput {
    /** The kind, as a band on the format clock names it: lowercase words joined by hyphens. Fixed once the kind is created, because every band and every break it ever planted carries it */
    key: string;
    /** What the console calls it. Never read out */
    name: string;
    /** What this kind of break is for and when to say nothing, written as an instruction to the presenter. The station's own rules for every break still apply on top of it */
    brief: string;
    /** Anything this kind owes beyond the rules every break owes, one per entry. Added to those rules, never in place of them */
    rules: string[];
    /** Whether the presenter is shown the record that has just finished */
    showsPrevious: boolean;
    /** Whether the presenter is shown the rest of this broadcast's records, to refer back to */
    showsPlayed: boolean;
    /** Whether the records shown carry the notes the station holds about them */
    showsFacts: boolean;
    /** Whether the presenter is shown their own notebook */
    showsNotebook: boolean;
    /** Whether the station writes this kind at all. A new or imported kind is off until you switch it on */
    enabled: boolean;
    /** Your own order, for the list */
    position: number;
}

/**
 * generated from [BreakKindList](../../../../../apps/api/data/contracts/director/break.kinds.types.ck)
 */
export interface BreakKindList {
    kinds: BreakKind[];
}

export interface BreakKindListInput {
    kinds: BreakKindInput[];
}
