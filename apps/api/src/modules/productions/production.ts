/**
 * What a production IS, as shapes with no behaviour.
 *
 * A production is several beats of speech, written in several passes, that airs as one block. The
 * distinction from a break is not length, it is whether the thing has an internal shape a missing
 * piece would break: a break that never got written costs the station a sentence, and beat 4 of six
 * missing is not a shorter programme, it is a programme with a hole in it.
 *
 * Everything here is JSON-safe, because two of these shapes are stored as `jsonb` columns and one is
 * parsed straight out of a model's answer.
 */

import type { GatePriority } from '#modules/shared/gate.priority.js';
import type { ProductionCast } from './production.cast.js';

/** How far along making one is. Mirrors the check constraint in migration 0016. */
export type ProductionState =
    | 'planned'
    | 'outlining'
    | 'drafting'
    | 'checking'
    | 'rendering'
    | 'stitching'
    | 'ready'
    | 'aired'
    | 'failed'
    | 'cancelled';

/** Nothing else will be spent on a production in one of these. */
const SETTLED: ReadonlySet<ProductionState> = new Set<ProductionState>(['aired', 'failed', 'cancelled']);

/**
 * Whether this production is over, whichever way it went.
 *
 * One predicate rather than the set spelled out at each call site, because every pass asks it and a
 * pass that forgot `cancelled` would be the exact failure the terminal state exists to prevent.
 */
export const isSettled = (state: ProductionState): boolean => SETTLED.has(state);

/**
 * How many passes an operator wants spent on one.
 *
 * The operator's choice rather than the station's, because the trade is theirs to make: on a
 * self-hosted model each extra pass is wall-clock rather than money, and how much of it a show is
 * worth depends on the show.
 */
export type WritingMode = 'quick' | 'outlined' | 'polished';

/** One thing a pass job does. See `production.passes.ts` for which modes run which. */
export type ProductionPass = 'outline' | 'draft' | 'check';

/**
 * One beat of the outline: what it is about, and what it owes the beats around it.
 *
 * **This is where foresight lives, and it is why a beat is never shown the future.** A beat told
 * "plant this" and "land that" has everything it needs to be part of a shape, at no context cost;
 * showing it the beats that come after would cost tokens on every draft and go stale the moment one
 * of them was rewritten.
 */
export interface OutlineBeat {
    /** What this beat is, in a few words. The only required field. */
    title: string;
    /** How to play it: the angle, the argument, the point of view. */
    angle?: string;
    /**
     * Which of the items this production was given this beat covers.
     *
     * Indexes into the caller's own list. Several beats may take different angles on one item, and
     * one beat may cover several related items.
     */
    itemIndexes?: number[];
    // There was a `lead` here, for an outline that named its own speaker. It is gone: who says a
    // beat is the station's arithmetic (`BeatPlan.speaker`), for the same reason how LONG a beat is
    // never came from the model. A model that named somebody the production was not given would be a
    // beat drafted as one character and spoken in another's voice, silently.
    /** Something planted here for a later beat to pay off. */
    setup?: string;
    /** A callback landing an earlier beat's setup. */
    payoff?: string;
}

/** The whole production's plan of content. */
export interface ProductionOutline {
    /** One line: what this production is really about. */
    throughline?: string;
    /** Threads that recur across beats, with no endpoint of their own. */
    runners: string[];
    /** One entry per beat, in running order. */
    beats: OutlineBeat[];
}

/**
 * How long one beat should run, in words.
 *
 * Computed rather than asked for — see `production.plan.ts`. The model supplies content and never
 * timing, which v1 learned the expensive way: one story in a ten-minute show meant a single beat
 * asked to carry about 1300 spoken words, which is unwritable.
 */
export interface BeatPlan {
    /** Where this beat comes, from 0. Matches `segments.production_ordinal`. */
    ordinal: number;
    /** About how many spoken words it should be. A target, and `production.checks.ts` judges against it. */
    words: number;
    /**
     * Who says it, as an index into {@link Production.casting}.
     *
     * Absent means whoever is presenting, which is every production the station made before it could
     * cast anybody. This is where `OutlineBeat.lead` went: the station decides, and the outline is
     * told.
     */
    speaker?: number;
}

/** The computed shape: how many beats, and how long each. */
export interface ProductionPlan {
    beats: BeatPlan[];
}

/** A production as it is read back. */
export interface Production {
    id: string;
    stationKey: string;
    broadcastId?: string;
    kind: string;
    title: string;
    brief?: string;
    personaId?: string;
    /** Who is in it, decided once by the first pass. Absent for a production made before it was cast. */
    casting?: ProductionCast;
    writingMode: WritingMode;
    targetMs: number;
    plan?: ProductionPlan;
    outline?: ProductionOutline;
    state: ProductionState;
    error?: string;
    scheduledFor?: number;
    cancelledAt?: number;
    actorId?: string;
    /** When it was commissioned. What a console orders the list by. */
    createdAt: number;
}

/**
 * How much the one model slot is worth to this production right now.
 *
 * **Earliest deadline, and the number is real** — a production's slot is a time somebody chose,
 * rather than an age this had to invent. Producing tomorrow's show yields to everything; producing
 * the one that airs in twenty minutes does not.
 *
 * That is what makes three working tiers enough. `gate.priority.ts` splits work with an air deadline
 * from work without one, and a production is the awkward case that is neither for its whole life: it
 * has no deadline for hours and then has a real one. Rather than inventing an aging rule, it simply
 * moves between the two tiers it already qualifies for.
 *
 * It never answers `breaking`, at any distance. That tier is reachable only through a `BreakUrgency`
 * on a request something raised because a moment happened, and a production scheduled for 9pm is the
 * opposite kind of thing — it has been known about for hours.
 *
 * An unscheduled production is `background` for its whole life, which is correct: nobody is waiting
 * on it, and it will air whenever it is finished.
 */
export function priorityForSlot(scheduledFor: number | undefined, now: number, withinMs: number): GatePriority {
    if (scheduledFor === undefined) return 'background';
    return scheduledFor - now <= withinMs ? 'air' : 'background';
}

/**
 * One loosely-typed beat from a model's answer, or `undefined` when it is unusable.
 *
 * A title is the one thing a beat cannot be written without, so a beat that has none is dropped
 * rather than given a placeholder — a beat called "Untitled" is one the drafting pass would write
 * something arbitrary for.
 *
 * **Out-of-range item indexes are dropped rather than trusted**, which is the detail worth carrying
 * across from v1: a hallucinated index does not fail, it silently points a beat at the wrong story,
 * and the resulting programme is confidently about something nobody asked for. Both `itemIndexes`
 * and the singular `itemIndex` are accepted, because models write either.
 */
export function coerceOutlineBeat(raw: Record<string, unknown>, itemCount: number): OutlineBeat | undefined {
    const title = text(raw.title);
    if (title === undefined) return undefined;

    const indexes = [...new Set(itemIndexList(raw).filter(index => Number.isInteger(index) && index >= 0 && index < itemCount))];

    // A `lead` in the answer is dropped rather than read. The outline is TOLD who has each beat, so
    // one naming somebody else is the model disagreeing with the cast — and the cast is the half
    // that gets rendered.
    return {
        title,
        ...maybe('angle', text(raw.angle)),
        ...maybe('setup', text(raw.setup)),
        ...maybe('payoff', text(raw.payoff)),
        ...(indexes.length === 0 ? {} : { itemIndexes: indexes }),
    };
}

/**
 * A whole outline from a model's answer, with the beats it could not use left out.
 *
 * Never throws and never answers a beatless outline as though it were a shape: a caller has to be
 * able to tell "the model gave me nothing usable" from "the model gave me an outline", because the
 * first means fall back and the second means carry on.
 */
export function coerceOutline(raw: unknown, itemCount: number): ProductionOutline | undefined {
    if (raw === null || typeof raw !== 'object') return undefined;
    const record = raw as Record<string, unknown>;

    const rawBeats = Array.isArray(record.beats) ? record.beats : [];
    const beats = rawBeats
        .filter((beat): beat is Record<string, unknown> => beat !== null && typeof beat === 'object')
        .map(beat => coerceOutlineBeat(beat, itemCount))
        .filter((beat): beat is OutlineBeat => beat !== undefined);

    if (beats.length === 0) return undefined;

    return {
        ...maybe('throughline', text(record.throughline)),
        runners: (Array.isArray(record.runners) ? record.runners : []).map(text).filter((line): line is string => line !== undefined),
        beats,
    };
}

/** A trimmed string, or `undefined` for anything that is not usable text. */
function text(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    return trimmed.length === 0 ? undefined : trimmed;
}

/** A key at a value, or nothing at all, so `undefined` never becomes a present-but-empty field. */
const maybe = <K extends string>(key: K, value: string | undefined): Partial<Record<K, string>> =>
    value === undefined ? {} : ({ [key]: value } as Record<K, string>);

/** Both spellings a model uses for "which items is this beat about". */
function itemIndexList(raw: Record<string, unknown>): number[] {
    if (Array.isArray(raw.itemIndexes)) return raw.itemIndexes.filter((value): value is number => typeof value === 'number');
    if (typeof raw.itemIndex === 'number') return [raw.itemIndex];
    return [];
}
