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

/**
 * What a generator is told before it chooses.
 *
 * **It is not told who is presenting**, and that is deliberate rather than an omission. A `persona`
 * was here, carried whole so that `ModelSetGenerator` could read its `music` line, and the field it
 * existed for is gone: a persona is who the station IS when it opens its mouth, and what the station
 * PLAYS is the brief's job. Nothing about a character's diction ever belonged in front of a record
 * chooser, and once the one line that did was removed there was nothing left to hand over.
 */
export interface SetInputs {
    /** How many tracks to name. A generator may return fewer; it must not return more. */
    count: number;
    /** The rules in force for the lineup being extended, already resolved from its mode. */
    rules: ResolvedRules;
    /**
     * What the operator asked this broadcast to play, in their own words.
     *
     * Free text and never parsed here: a generator that can read an instruction acts on it, and
     * one that cannot ignores it. The deterministic floor is the second kind on purpose — a brief
     * it could not honour must not change what it draws — so a station whose brief nothing can
     * satisfy gets an ordinary hour rather than a short one.
     */
    brief?: string;
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
     * Whether this binding is deaf to {@link SetInputs.brief}.
     *
     * Declared rather than inferred, because it is the one property an operator can act on: a
     * station told "flamenco guitar" and handed grunge was served by a generator that could not
     * read the instruction, and `rotation.briefOnly` is the switch that says whether that is
     * acceptable. `SetGeneratorChain` reads this and nothing else does.
     *
     * False by default, so the honest answer is the one a binding has to opt out of. A generator
     * that reads a brief PARTLY — the chart binding uses it to choose between charts and not to
     * filter one — is false here: it acted on the instruction, and how well is a question about
     * that generator rather than about whether it listened.
     */
    readonly ignoresBrief: boolean = false;

    /**
     * Name up to `count` tracks for the station to play.
     *
     * Returning fewer is an ordinary outcome, not a failure: a small library
     * under a wide repeat window genuinely has less to offer, and the caller
     * would rather have four tracks than an exception.
     */
    abstract generate(inputs: SetInputs): Promise<TrackPick[]>;
}
