/**
 * One part of an arc, in the order it is to be told.
 *
 * `deadair.persona_story_beats` (migration 0035). A `PersonaStory` whose `kind` is `arc` is told a
 * part at a time: one beat reaches a break, the next is owed once that one has AIRED, and the arc is
 * finished when there are none left.
 *
 * ## A beat is a SCRIPT, and that is the same decision `PersonaStory.story` made
 *
 * It is spoken as it stands, which is what keeps the `story` break's floor unable to fail. A column
 * of stage directions — "he admits he was never there" — would need a model to turn it into words,
 * and a station with no model would then hold arcs it could never tell.
 *
 * ## A BEAT is not a DETAIL, though the two tables look alike
 *
 * {@link PersonaStoryDetail} is something the story picked up. It has no position, every active one
 * is shown at once, and the story is no further along for having it. A beat is one telling's worth
 * of material and exactly ONE is ever shown. That difference is the whole of what makes an arc an
 * arc, and it is why this is a second table rather than an `ordinal` column on the first.
 *
 * ## Gaps in the order are legal
 *
 * {@link PersonaStoryBeat.ordinal} sorts and nothing else reads it. An operator inserting a part
 * between two others should not have to renumber the rest, and a pass proposing one to go at the end
 * should not have to know what the end currently is.
 *
 * ## A proposal waits, exactly as everything else a model writes here does
 *
 * `suggested` until somebody says otherwise, and `rejected` is a state rather than a deletion, or
 * the nightly pass proposes the same part forever. See `persona.story.ts`.
 */

import type { PersonaStoryOrigin, PersonaStoryState } from './persona.story.js';

/** A beat as somebody wrote it, before it is a row. */
export interface PersonaStoryBeatDraft {
    /** Where it comes in the telling. Gaps are legal; see the file note. */
    ordinal: number;
    /** The part itself, in the character's voice, already speakable. */
    beat: string;
    /** Where a proposal came from. Not evidence — see `PersonaStory.source`. */
    source?: string;
}

/** A beat as it is stored. */
export interface PersonaStoryBeat extends PersonaStoryBeatDraft {
    id: string;
    storyId: string;
    state: PersonaStoryState;
    origin: PersonaStoryOrigin;
    createdAt: string;
}

/**
 * The one part of an arc a break is being handed, and where the last one left it.
 *
 * {@link leftAt} is the PREVIOUS beat's own text rather than what the break actually said about it,
 * which is a deliberate choice between two things that both exist. The words a break used are in the
 * ledger and are the honest record; they are also unapproved prose that a model would be invited to
 * repeat, and they are swept from `script_history` eventually. The previous beat is something an
 * operator wrote, has no retention problem, and says what the listener was told rather than how.
 */
export interface PersonaStoryBeatForPrompt {
    text: string;
    /** What the last part said, so this one continues rather than restarts. Absent for the first. */
    leftAt?: string;
    /** Whether this is the end of it, which changes how a character is asked to land it. */
    last: boolean;
}
