/**
 * What has happened to a character, in its own telling.
 *
 * A persona could refer to nothing that ever happened to it. `PersonaSheet.background` is two
 * grounded sentences sent whole on every prompt, so it has to stay two; `PersonaNote` is one sentence
 * distilled out of what the character actually broadcast. Neither is an anecdote, and an anecdote is
 * most of what a listener remembers a presenter for. These are the rows that answer that, and the
 * store behind them is `deadair.persona_stories` (migration 0021).
 *
 * ## A story is the character's own, and the station stands behind none of it
 *
 * That is the line this whole file is drawn on, and it is the opposite posture to `deadair.facts`
 * one module over. A FACT is a claim about the world and must carry the source that supports it, or
 * a DJ says something specific, checkable and untrue in the voice it uses for things that are true.
 * A STORY is not a claim about the world at all — it is who this character says they are — so
 * {@link PersonaStory.source} is nullable prose for the operator reading a proposal and nothing
 * downstream reads it as evidence.
 *
 * What keeps that safe is at the other end, in `break.prompt.ts`: a story is offered as something
 * that happened to YOU, and may never be attached to a record as a fact about the record. The whole
 * risk of this feature is a model hanging an anecdote off a discography, and the prompt is where it
 * is refused rather than here.
 *
 * ## A story GROWS, which is why it is a row with children
 *
 * {@link PersonaStoryDetail} is one thing the story has picked up since it was written — the operator
 * adding it, or the enrichment pass proposing it. One row per detail rather than a rewrite of the
 * telling, because a rewrite offers an operator a whole new version to accept or refuse with nothing
 * saying which sentence is new, and what they actually want to turn down is the one invented clause.
 *
 * ## A proposal waits, and a rejection is a state
 *
 * `deadair.pronunciations`' shape exactly, and `persona_notes`' after it: anything a model wrote
 * arrives {@link PersonaStoryState} `suggested` and the operator is the check, because no amount of
 * catalogue entails that this character was ever in that room. `rejected` outlives the pass that
 * proposed it, or the same pass proposes it again forever.
 *
 * ## The floor can tell one, which is unusual and deliberate
 *
 * {@link PersonaStory.story} is already speakable prose somebody wrote, so the deterministic writer
 * of a `story` break simply speaks it. Everywhere else in the station a floor is a template pool and
 * a model is what makes it sound like anybody; here the model retells a story the station could have
 * told without it. See `story.break.writer.ts`.
 */

/** Whether a story or a detail can be told, is waiting to be looked at, or was turned down. */
export const PERSONA_STORY_STATES = ['active', 'suggested', 'rejected'] as const;

export type PersonaStoryState = (typeof PERSONA_STORY_STATES)[number];

/** Who says so. `model` is the enrichment pass writing from what the station already holds. */
export const PERSONA_STORY_ORIGINS = ['operator', 'model'] as const;

export type PersonaStoryOrigin = (typeof PERSONA_STORY_ORIGINS)[number];

/** A story as somebody wrote it, before it is a row. */
export interface PersonaStoryDraft {
    /**
     * A short handle: "The Barstow lights".
     *
     * NEVER spoken. It is what the console lists, what a log line names, and what a proposal
     * identifies itself as — and it is what the unique index is over, so two tellings of the same
     * night are one story with two details rather than two stories.
     */
    title: string;
    /** The telling itself, in the character's voice. A few sentences: see the note on the floor above. */
    story: string;
    /**
     * Where a proposal came from, in the station's own words. Absent for anything an operator wrote.
     *
     * Not evidence. See the note at the top of this file for why that distinction is the load-bearing
     * one here and not a quibble about naming.
     */
    source?: string;
}

/** A story as it is stored, with whatever it has picked up since. */
export interface PersonaStory extends PersonaStoryDraft {
    id: string;
    personaKey: string;
    state: PersonaStoryState;
    origin: PersonaStoryOrigin;
    /** What it has accumulated, in every state, for the console. See {@link PersonaStoryForPrompt}. */
    details: PersonaStoryDetail[];
    /** When it was last carried into a break, for the rotation. Absent means never told. */
    lastToldAt?: string;
    /** How often it has actually gone out, which the prompt reads. See {@link PersonaStoryForPrompt}. */
    timesTold: number;
    createdAt: string;
}

/** One thing a story has picked up since it was written. */
export interface PersonaStoryDetail {
    id: string;
    storyId: string;
    detail: string;
    state: PersonaStoryState;
    origin: PersonaStoryOrigin;
    source?: string;
    createdAt: string;
}

/**
 * How many of a story's details reach a prompt.
 *
 * `PERSONA_SHEET_LIMITS`' rule and the same argument: every line of accumulated colour is a line of
 * "never name a record you were not given" further from the end of the turn. Six is already a story
 * whose details outweigh it, which is a dossier rather than something somebody would say.
 */
export const PERSONA_STORY_DETAIL_LIMIT = 6;

/**
 * The one story a break is offered, already chosen and capped.
 *
 * A single story rather than a list, and that is the whole shape of this feature: the measured
 * failure of handing a model material is that the model gets through the material, and a list of
 * anecdotes in a forty-word break would be a presenter reading their own biography. The rotation
 * decides which one; the prompt decides whether to render it at all.
 *
 * {@link timesTold} rides along because a story a regular listener may already have heard is told
 * differently from one nobody has, and that is a thing only the store knows.
 */
export interface PersonaStoryForPrompt {
    title: string;
    story: string;
    details: readonly string[];
    timesTold: number;
}
