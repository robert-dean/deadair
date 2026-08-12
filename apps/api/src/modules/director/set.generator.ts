import type { ResolvedRules } from './rotation.rules.js';

/**
 * Choosing what the station should play next, as one DI seam.
 *
 * A pick is a **named** track — a title and an artist as strings — and not an
 * id, which is the whole point of the shape. That is what a language model can
 * return, so an LLM DJ later is a second binding of this token rather than a
 * reshape of everything downstream of it. The deterministic generator here
 * happens to know the catalog id as well and passes it along, which makes
 * resolution exact for it and best-effort for anything else.
 *
 * Declared as an abstract class so injectkit can use it as a token, and kept
 * free of any implementation's imports, exactly like `TrackResolver` in the
 * playout module.
 */

/** One track a generator has chosen. */
export interface TrackPick {
    title: string;
    /** The lead artist, as a name. Not a credit line: this is what identity is taken from. */
    artist: string;
    /**
     * The canonical `deadair.tracks` id, when the generator already knows it.
     * Absent from anything that chose by name, which resolves by matching.
     */
    trackId?: string;
}

/** What a generator is told before it chooses. */
export interface SetInputs {
    /** How many tracks to name. A generator may return fewer; it must not return more. */
    count: number;
    /** The rules in force for the lineup being extended, already resolved from its mode. */
    rules: ResolvedRules;
    /** Songs not to choose, beyond whatever history says: what the lineup already holds. */
    avoidSongKeys?: ReadonlySet<string>;
    /** Artists not to choose, for the same reason. */
    avoidArtistKeys?: ReadonlySet<string>;
}

export abstract class SetGenerator {
    /**
     * What this binding is called, for the log and for anything that reports which one chose.
     *
     * The sibling of `BreakWriter.name` and there for the same reason: once several bindings can
     * answer, "the station picked these fifteen tracks" is only half a fact. Which one picked them
     * is the other half, and it is the half that says whether a model is actually being used.
     */
    abstract readonly name: string;

    /**
     * Name up to `count` tracks for the station to play.
     *
     * Returning fewer is an ordinary outcome, not a failure: a small library
     * under a wide repeat window genuinely has less to offer, and the caller
     * would rather have four tracks than an exception.
     */
    abstract generate(inputs: SetInputs): Promise<TrackPick[]>;
}
