/**
 * What a character has accumulated, which its sheet cannot hold.
 *
 * A persona is a sheet somebody wrote and a break is written against that sheet plus the last few
 * scripts of this broadcast, so a host has never been able to refer back to something it said last
 * week or stay consistent about an opinion it has already put on air. These are the lines that
 * answer that, and the store behind them is `deadair.persona_notes` (migration 0020).
 *
 * ## The two kinds are two different claims, and that is the whole design
 *
 * A {@link PersonaNoteKind} of `said` records something this character actually put on air. Its
 * evidence is the station's own script, so nothing was inferred and it goes active unattended.
 *
 * A `trait` is an inference about who the character is becoming, which nothing can verify: no quote
 * entails "has started addressing the listener as a friend". So it arrives `suggested` and the
 * operator is the check. That asymmetry is deliberate and is the answer to the question
 * [personas](https://github.com/robert-dean/deadair/discussions/25) §2 left open — a `trait` note read into a prompt IS a sheet edit, and a
 * station making those unattended would drift out of the character its author can still see on the
 * page.
 *
 * ## Where each one is rendered, and why they are not one list
 *
 * A `trait` goes in the SYSTEM turn beside the sheet, because it is who the presenter is. A `said`
 * goes in the USER turn beside what the show has played, because it is what the presenter did. That
 * is the same split `break.prompt.ts` already makes between the persona and the broadcast's memory,
 * and putting both in one place would either make a fact about last Tuesday part of the character or
 * make the character a passing detail of this hour.
 *
 * ## They reach the model only
 *
 * The deterministic floor writes from `rotation.breakTemplates` and a persona's own phrasings, and a
 * template has nowhere to put a sentence like this. So a station with no model keeps its notebook and
 * never says anything out of it, which is the ordinary shape of everything else here: the floor
 * cannot fail, and what capability buys is depth.
 */

/** Whether a note records what the character DID or infers what it IS. */
export const PERSONA_NOTE_KINDS = ['said', 'trait'] as const;

export type PersonaNoteKind = (typeof PERSONA_NOTE_KINDS)[number];

/**
 * Whether a note is carried into breaks, waiting to be looked at, or turned down.
 *
 * `rejected` is a state rather than a deletion, for `deadair.pronunciations`' reason: the distil pass
 * re-reads the same scripts and a deleted proposal would come back forever.
 */
export const PERSONA_NOTE_STATES = ['active', 'suggested', 'rejected'] as const;

export type PersonaNoteState = (typeof PERSONA_NOTE_STATES)[number];

/** Who says so. `model` is the distil pass reading this character's own history back. */
export const PERSONA_NOTE_ORIGINS = ['operator', 'model'] as const;

export type PersonaNoteOrigin = (typeof PERSONA_NOTE_ORIGINS)[number];

/** A note as somebody wrote it, before it is a row. */
export interface PersonaNoteDraft {
    kind: PersonaNoteKind;
    /** One sentence. See {@link PERSONA_NOTE_LIMITS} for why it stays one. */
    note: string;
    /**
     * The attempt this was drawn from, while that row still exists.
     *
     * `render.prune_script_history` sweeps that table nightly, which is why {@link sourceQuote} is
     * kept beside this rather than reached through it: a note legitimately outlives its evidence's
     * row and must not thereby lose its evidence.
     */
    sourceScriptId?: string;
    /** The words that support it, as the station actually said them. Required of anything a model wrote. */
    sourceQuote?: string;
}

/** A note as it is stored. */
export interface PersonaNote extends PersonaNoteDraft {
    id: string;
    personaKey: string;
    state: PersonaNoteState;
    origin: PersonaNoteOrigin;
    /** When it was last carried into a break, for the rotation. Absent means never. */
    lastUsedAt?: string;
    createdAt: string;
}

/**
 * How many of each kind reach a prompt.
 *
 * `PERSONA_SHEET_LIMITS`' rule, and the same argument: a sheet has to stay a sheet. These share a
 * system turn with the grounding rules, the model is a local one, and every line of accumulated
 * flavour is a line of "never name a record you were not given" further from the end of the prompt.
 *
 * Traits are capped harder than sayings because they are the half that competes with the sheet
 * itself. Six quirks and four traits is already a character described twice; a dozen of each is a
 * model reading a dossier and answering in its own voice because nothing in it was memorable.
 */
export const PERSONA_NOTE_LIMITS = {
    trait: 4,
    said: 6,
} as const;

/** The half of a notebook a prompt uses, already capped and in the order it should be rendered. */
export interface PersonaNotesForPrompt {
    /** Who this character has become. Rendered in the system turn, after the sheet. */
    trait: readonly string[];
    /** What this character has said before. Rendered in the user turn, beside the show's memory. */
    said: readonly string[];
}

/** Whether a notebook has anything in it at all, so a prompt with none stays byte-identical. */
export const notesAreEmpty = (notes: PersonaNotesForPrompt | undefined): boolean =>
    notes === undefined || (notes.trait.length === 0 && notes.said.length === 0);
