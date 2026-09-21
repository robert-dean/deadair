/**
 * Every time one of a character's stories was carried into something it said.
 *
 * `PersonaStory` is what a character has to tell. This is the record of it actually going out, and
 * the store behind it is `deadair.persona_tellings` (migration 0034). It exists because three
 * separate things asked the same question of two self-overwriting stamps and none of them could be
 * answered:
 *
 * - **A story that ADVANCES needs a place in it.** `timesTold` counts how often a story came round
 *   and cannot say which PART went out, so nothing could owe the next one.
 * - **A callback needs what was actually said.** `script_history` holds the words and is swept
 *   nightly, so {@link PersonaTelling.said} is denormalised here for `persona_notes.source_quote`'s
 *   reason exactly.
 * - **An operator undoing what the station accrued needs something to undo.** A stamp that has been
 *   overwritten has no earlier value; rows have.
 *
 * ## Carried and told are two different facts
 *
 * A story handed to a writer in `offered` mode may simply be ignored, and a break that fell to the
 * deterministic floor said nothing of it at all. So every carry writes a row — which is what moves
 * the rotation on, or a story the model keeps passing over would block the shelf forever — while
 * only {@link PersonaTelling.told} moves a story's own progress.
 *
 * {@link PersonaTelling.told} is the WRITER's read-back of its own answer and never the model's word
 * for it. `weather.figures.ts` records why: a model asked to report what it just did is a check that
 * approves its own work.
 *
 * ## Written when the writer won, stamped when the listener could hear it
 *
 * The row is written after `SegmentRepository.writeScript` succeeds rather than when the story was
 * READ, which is the correction this table makes to the old stamp. `breaks.md` records what spending
 * at selection cost the bulletin that does it: three rewrites emptied the window and lost seven
 * bulletins in two hours.
 *
 * {@link PersonaTelling.airedAt} is then stamped on the aired edge, and the gap between the two is
 * load-bearing rather than bookkeeping: a beat is owed until it has AIRED, so a break retracted
 * before its slot does not silently cost a listener episode two.
 */

/** What wrote a telling. `backfill` is migration 0034's own rows, which carry no script. */
export const PERSONA_TELLING_SOURCES = ['break', 'production', 'backfill'] as const;

export type PersonaTellingSource = (typeof PERSONA_TELLING_SOURCES)[number];

/**
 * Whether the story was handed over as something the writer MAY use, or as the thing the break is
 * for. `BreakPromptShape.stories`' own two values, recorded so a timeline can say which.
 */
export const PERSONA_TELLING_MODES = ['offered', 'told'] as const;

export type PersonaTellingMode = (typeof PERSONA_TELLING_MODES)[number];

/**
 * How much of a script is kept as the record of what was said.
 *
 * A break is tens of words and a production turn is longer, so this is a ceiling rather than a
 * budget — it exists so one pathological script cannot make the timeline expensive to read, not to
 * trim anything a break would actually produce. `PERSONA_SHEET_LIMITS`' posture, one table over.
 */
export const PERSONA_TELLING_SAID_LIMIT = 2_000;

/** A telling on its way in, with everything only the writer of the break knows. */
export interface PersonaTellingWrite {
    personaKey: string;
    storyId: string;
    /**
     * WHICH part of an arc this told, so the next is owed rather than guessed at.
     *
     * Absent for an anecdote and for a bit, neither of which has parts. What makes this worth a
     * column rather than a count is the retraction case: a break is planned up to eight items ahead
     * of its slot, so "the third telling" and "the third part" come apart the moment one is dropped.
     */
    beatId?: string;
    /** The break that carried it. Absent for a backfilled row, whose segment is long gone. */
    segmentId?: string;
    source: PersonaTellingSource;
    mode: PersonaTellingMode;
    /** Whether the writer's own read-back found the story in the words it wrote. See the file note. */
    told: boolean;
    /** The words that carried it, capped at {@link PERSONA_TELLING_SAID_LIMIT}. */
    said?: string;
}

/** A telling as it is stored. */
export interface PersonaTelling extends PersonaTellingWrite {
    id: string;
    /**
     * When it was written, as the column's own TEXT rather than as a `DateTime`.
     *
     * Postgres keeps a `timestamptz` to the microsecond and Luxon cannot represent one, so a round
     * trip truncates and the value compares as EARLIER than the row it came from. That is the bug
     * `persona_note_passes.read_through` was carried as text to avoid, and it bites harder here:
     * this string is what an operator hands back to say "roll back to here", so a truncated one
     * deletes the row they clicked on.
     */
    at: string;
    /** When a listener could first have heard it. Absent means written but not yet aired. */
    airedAt?: string;
}
