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
 * One person in a production: the presenter, or somebody cast to phone in. A snapshot rather than a
 * reference, because the persona it names may be edited or deleted while the programme is still being
 * made and what the turns were written as has to be what an operator reads back
 * generated from [ProductionCastMember](../../../../../apps/api/data/contracts/productions/productions.types.ck#L10)
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
 * generated from [ProductionRequest](../../../../../apps/api/data/contracts/productions/productions.types.ck#L39)
 */
export interface ProductionRequest {
    kind?: string;
    /** Absent is named after its kind and the moment it was asked for, which is what somebody taking a call now wants rather than a box to fill in */
    title?: string;
    brief?: string;
    personaId?: string;
    /** Absent takes the station's `render.productionWritingMode` */
    writingMode?: 'quick' | 'outlined' | 'polished';
    targetMs?: number;
    scheduledFor?: DateTime;
}

/** Rehydrates every wire-encoded scalar in a ProductionRequest into its runtime type. Mutates and returns `raw`. */
export function reviveProductionRequest(raw: ProductionRequest): ProductionRequest {
    const __o0 = raw as unknown as Record<string, unknown>;
    if (__o0['scheduledFor'] != null) {
        __o0['scheduledFor'] = __dt(__o0['scheduledFor'], 'ProductionRequest.scheduledFor');
    }
    return raw;
}

/**
 * Something the station makes rather than something it says: several beats of speech, written in several passes, that airs as one block
 * generated from [Production](../../../../../apps/api/data/contracts/productions/productions.types.ck#L17)
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
    /** `stitching` is the beats being joined into one piece of audio, and it leads to `ready` whether that worked or not */
    state: 'planned' | 'outlining' | 'drafting' | 'checking' | 'rendering' | 'stitching' | 'ready' | 'aired' | 'failed' | 'cancelled';
    /** Why making it did not work */
    error?: string;
    /** When it should air. Absent means as soon as it is made */
    scheduledFor?: DateTime;
    cancelledAt?: DateTime;
    /** How many beats exist so far, which is how far along the drafting is */
    beats: number;
    /** Who is on it, decided by the first pass that ran. Empty for one nobody has started, and for a programme the presenter reads alone */
    cast: ProductionCastMember[];
    createdAt: DateTime;
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
    scheduledFor?: DateTime;
}

/** Rehydrates every wire-encoded scalar in a Production into its runtime type. Mutates and returns `raw`. */
export function reviveProduction(raw: Production): Production {
    const __o0 = raw as unknown as Record<string, unknown>;
    if (__o0['scheduledFor'] != null) {
        __o0['scheduledFor'] = __dt(__o0['scheduledFor'], 'Production.scheduledFor');
    }
    if (__o0['cancelledAt'] != null) {
        __o0['cancelledAt'] = __dt(__o0['cancelledAt'], 'Production.cancelledAt');
    }
    __o0['createdAt'] = __dt(__o0['createdAt'], 'Production.createdAt');
    return raw;
}

/**
 * generated from [ProductionList](../../../../../apps/api/data/contracts/productions/productions.types.ck#L34)
 */
export interface ProductionList {
    productions: Production[];
}

export interface ProductionListInput {
    productions: ProductionInput[];
}

/** Rehydrates every wire-encoded scalar in a ProductionList into its runtime type. Mutates and returns `raw`. */
export function reviveProductionList(raw: ProductionList): ProductionList {
    const __o0 = raw as unknown as Record<string, unknown>;
    {
        const __a1 = __o0['productions'] as unknown[];
        for (let __i2 = 0; __i2 < __a1.length; __i2++) {
            reviveProduction(__a1[__i2] as never);
        }
    }
    return raw;
}
