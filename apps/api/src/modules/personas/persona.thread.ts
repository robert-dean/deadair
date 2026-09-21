import type { PersonaStoryKind } from './persona.story.js';

/**
 * Which of a character's stories a break should be handed, and which part of it.
 *
 * A pure function over what the store already knows, so the decision can be tested against awkward
 * timing without a database and so the audition path can make the same decision from its own
 * run-local rows rather than from the ledger. Everything it needs is in {@link ThreadCandidate}.
 *
 * ## The three kinds are eligible for different reasons
 *
 * An ANECDOTE is always eligible. It is self-contained, the rotation decides when it comes round,
 * and that behaviour is exactly what it was before arcs existed.
 *
 * An ARC is eligible while it still owes a part. The next part is the lowest-numbered active beat
 * with no AIRED telling — aired rather than written, because a break is planned up to eight items
 * ahead of its slot and can be retracted in between, and a part skipped on the strength of a break
 * nobody heard is one nothing will ever offer again.
 *
 * A BIT never runs out, so it is eligible whenever the gap allows.
 *
 * ## The gap, and the thing it actually prevents
 *
 * Breaks are WRITTEN ahead of air, so without a cadence guard two breaks planned before either of
 * them airs would both be handed part two. The gap makes a thread ineligible while any telling of it
 * is younger than {@link gapMs}, which is why that setting's floor has to stay above the planner's
 * write-ahead horizon.
 *
 * It also answers the other direction: a telling older than the gap that never aired is treated as
 * VOID, so a break that was dropped gives its part back rather than stalling the arc forever.
 *
 * The gap deliberately does NOT apply to an anecdote. There, the rotation is the whole mechanism and
 * always has been; adding a second one would change behaviour this feature has no quarrel with.
 */
export function nextThread(candidates: readonly ThreadCandidate[], now: number, gapMs: number): ChosenThread | undefined {
    for (const candidate of candidates) {
        if (candidate.kind === 'anecdote') return { id: candidate.id };

        // Told recently enough that a break planned in the meantime may not have aired yet. Waiting
        // is the whole guard: the next pass over the shelf will reach it.
        if (candidate.lastCarriedAt !== undefined && now - candidate.lastCarriedAt < gapMs) continue;

        if (candidate.kind === 'bit') return { id: candidate.id };

        const owed = candidate.beats.findIndex(beat => !beat.aired);
        // Every part has been heard, so the arc is finished. Not an error and not a state anybody
        // has to set: an arc simply stops being offered once it has been told out.
        if (owed === -1) continue;

        return {
            id: candidate.id,
            beat: {
                id: candidate.beats[owed]!.id,
                text: candidate.beats[owed]!.beat,
                // The PREVIOUS part's own words rather than what a break said about it. Both exist;
                // this one is prose an operator approved, has no retention problem, and says what
                // the listener was told rather than how. See `PersonaStoryBeatForPrompt.leftAt`.
                ...(owed === 0 ? {} : { leftAt: candidate.beats[owed - 1]!.beat }),
                last: owed === candidate.beats.length - 1,
            },
        };
    }

    return undefined;
}

/** One story on the shelf, with everything eligibility turns on. */
export interface ThreadCandidate {
    id: string;
    kind: PersonaStoryKind;
    /** The parts, in telling order. Active only, and empty for anything that is not an arc. */
    beats: readonly { id: string; beat: string; aired: boolean }[];
    /** When this was last handed to anything, told or not. Absent means never. */
    lastCarriedAt?: number;
}

/** The story a break gets, and the part of it when there is one. */
export interface ChosenThread {
    id: string;
    beat?: { id: string; text: string; leftAt?: string; last: boolean };
}
