/**
 * One person in a production: the presenter, or somebody cast to phone in. A snapshot rather than a
 * reference, because the persona it names may be edited or deleted while the programme is still being
 * made and what the turns were written as has to be what an operator reads back
 * generated from [ProductionCastMember](file://./../../../../../apps/api/data/contracts/productions/productions.types.ck#L10)
 */
export interface ProductionCastMember {
    role: 'host' | 'caller';
    /** What they are called on air */
    name?: string;
    /** The persona key, for a link back to the character */
    persona?: string;
}

/**
 * What an operator asks for. Everything else about a production is decided by the passes that make it
 * generated from [ProductionRequest](file://./../../../../../apps/api/data/contracts/productions/productions.types.ck#L39)
 */
export interface ProductionRequest {
    kind?: string;
    title: string;
    brief?: string;
    personaId?: string;
    /** Absent takes the station's `render.productionWritingMode` */
    writingMode?: 'quick' | 'outlined' | 'polished';
    targetMs?: number;
    scheduledFor?: string;
}

/**
 * Something the station makes rather than something it says: several beats of speech, written in several passes, that airs as one block
 * generated from [Production](file://./../../../../../apps/api/data/contracts/productions/productions.types.ck#L17)
 */
export interface Production {
    id: string;
    /** What sort of production: podcast, bulletin, feature. Free text, so a station that wants a documentary strand needs no migration */
    kind: string;
    title: string;
    /** What was asked for, in the operator's own words. Distinct from the title, which is only a label */
    brief?: string;
    /** Who presents it. Absent falls back to the station's active persona when a pass runs */
    personaId?: string;
    /** How many passes to spend on it */
    writingMode: 'quick' | 'outlined' | 'polished';
    /** How long it should run. What the beat count and the per-beat word budgets are computed from */
    targetMs: number;
    state: 'planned' | 'outlining' | 'drafting' | 'checking' | 'rendering' | 'ready' | 'aired' | 'failed' | 'cancelled';
    /** Why making it did not work */
    error?: string;
    /** When it should air. Absent means as soon as it is made */
    scheduledFor?: string;
    cancelledAt?: string;
    /** How many beats exist so far, which is how far along the drafting is */
    beats: number;
    /** Who is on it, decided by the first pass that ran. Empty for one nobody has started, and for a programme the presenter reads alone */
    cast: ProductionCastMember[];
    createdAt: string;
}

export interface ProductionInput {
    /** What sort of production: podcast, bulletin, feature. Free text, so a station that wants a documentary strand needs no migration */
    kind: string;
    title: string;
    /** What was asked for, in the operator's own words. Distinct from the title, which is only a label */
    brief?: string;
    /** Who presents it. Absent falls back to the station's active persona when a pass runs */
    personaId?: string;
    /** How many passes to spend on it */
    writingMode: 'quick' | 'outlined' | 'polished';
    /** How long it should run. What the beat count and the per-beat word budgets are computed from */
    targetMs: number;
    /** When it should air. Absent means as soon as it is made */
    scheduledFor?: string;
}

/**
 * generated from [ProductionList](file://./../../../../../apps/api/data/contracts/productions/productions.types.ck#L34)
 */
export interface ProductionList {
    productions: Production[];
}

export interface ProductionListInput {
    productions: ProductionInput[];
}
