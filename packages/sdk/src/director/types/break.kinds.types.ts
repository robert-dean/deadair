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
 * One kind of break in a file: everything that says what it is, and nothing about how this station has it set
 * generated from [BreakKindFileKind](../../../../../apps/api/data/contracts/director/break.kinds.types.ck)
 */
export interface BreakKindFileKind {
    /** What identifies the kind across two stations, and what a band on the format clock names */
    key: string;
    name: string;
    brief: string;
    rules: string[];
    showsPrevious: boolean;
    showsPlayed: boolean;
    showsFacts: boolean;
    showsNotebook: boolean;
}

/**
 * Something to know before pressing Import
 * generated from [BreakKindImportNotice](../../../../../apps/api/data/contracts/director/break.kinds.types.ck)
 */
export interface BreakKindImportNotice {
    /** Which sort, so a console can group by it rather than parsing the sentence */
    kind: 'format' | 'duplicate' | 'switched-off' | 'refused';
    /** The whole of it, in the station's own words */
    message: string;
}

export interface BreakKindImportNoticeInput {}

/**
 * generated from [BreakKindList](../../../../../apps/api/data/contracts/director/break.kinds.types.ck)
 */
export interface BreakKindList {
    kinds: BreakKind[];
}

export interface BreakKindListInput {
    kinds: BreakKindInput[];
}

/**
 * Kinds of break as a file, to move between stations. No id, no place in a list and no switch: a kind arrives switched off wherever it lands, so it is read back before it airs
 * generated from [BreakKindFile](../../../../../apps/api/data/contracts/director/break.kinds.types.ck)
 */
export interface BreakKindFile {
    /** What shape this is, so a file from a later build says so rather than being read wrongly */
    format: string;
    /** When it was exported, ISO-8601 */
    takenAt: string;
    /** The station it was taken from. Provenance only */
    station?: string;
    kinds: BreakKindFileKind[];
}

/**
 * One kind in a file, and what would become of it here
 * generated from [BreakKindImportEntry](../../../../../apps/api/data/contracts/director/break.kinds.types.ck)
 */
export interface BreakKindImportEntry {
    key: string;
    name: string;
    /** New here; already here and named in `replace`, so rewritten; already here and left alone; or a key this station uses for a break of its own, which no file can take */
    outcome: 'create' | 'update' | 'skip' | 'refuse';
    notices: BreakKindImportNotice[];
}

export interface BreakKindImportEntryInput {}

/**
 * What importing a file WOULD do here, worked out by the same code the import runs and written nowhere
 * generated from [BreakKindImportPlan](../../../../../apps/api/data/contracts/director/break.kinds.types.ck)
 */
export interface BreakKindImportPlan {
    /** What the file said it was */
    format: string;
    /** The station it was taken from, when it said */
    station?: string;
    /** When it was taken, when it said */
    takenAt?: string;
    /** About the file rather than any one kind in it */
    notices: BreakKindImportNotice[];
    kinds: BreakKindImportEntry[];
}

export interface BreakKindImportPlanInput {}

/**
 * What importing did, with the plan it did it from. All or nothing
 * generated from [BreakKindImportResult](../../../../../apps/api/data/contracts/director/break.kinds.types.ck)
 */
export interface BreakKindImportResult {
    plan: BreakKindImportPlan;
    created: number;
    /** Kinds rewritten from the file, and switched off until read back */
    updated: number;
    /** Kinds this station already held and was not asked to replace, or could not take */
    skipped: number;
    /** The list as it now stands */
    kinds: BreakKind[];
}

export interface BreakKindImportResultInput {}
