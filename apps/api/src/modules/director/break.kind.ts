/**
 * A kind of break an operator writes, as the station holds it. Ideas #24.
 *
 * The data half of a `BreakPromptShape`, field for field, plus the operator's own name for it and
 * the switch that says whether it airs. Nothing here is code: a kind that fetched live data would be
 * a plugin.
 */
export interface AuthoredKind {
    id: string;
    /** The kind itself, as `segments.kind` and a clock band spell it. Fixed once created. */
    key: string;
    /** What the console calls it. Never read out. */
    name: string;
    /** What this kind of break is for, in the operator's prose. Becomes the shape's `job`. */
    brief: string;
    /** What it owes on top of the rules every break owes. Appended, never in place of them. */
    rules: string[];
    showsPrevious: boolean;
    showsPlayed: boolean;
    showsFacts: boolean;
    showsNotebook: boolean;
    enabled: boolean;
    position: number;
}

/** A kind as it is written: everything but the id the table gives it. */
export type AuthoredKindDraft = Omit<AuthoredKind, 'id'>;
