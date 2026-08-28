/**
 * A character as a FILE: what somebody sends somebody else, and what an operator keeps.
 *
 * `docs/todo/backup-and-restore.md` argues the whole import/export feature from this one case — a
 * `pg_dump` already moves one install onto itself, and what it cannot do is share a PIECE. A persona
 * is the piece worth sharing first, because it is a whole character rather than a fragment of
 * configuration: a sheet, its phrasings, and the things that have happened to it.
 *
 * ## The document is a contract that already existed
 *
 * `PersonaFilePersona` is `PersonaDraftView` plus two fields, and that is not thrift. `PersonaDraftView`
 * is the sheet as a FORM's contents — no `id`, not on air — which is precisely what may cross between
 * two installs, so **an imported file can never change who is presenting and can never collide with a
 * row it did not mean**. That property is enforced by the contract rather than by a guard somebody has
 * to remember to write, and it is the reason to build on that shape instead of describing the row
 * again.
 *
 * The two fields it adds back are the two `toDraftView` deliberately withholds, and the reason it
 * withholds them does not apply here. `soundboard` is left out of a GENERATED draft because a model
 * inventing a board names a rack that does not exist; a file comes off a real install, where the board
 * is a fact. `kind` is left out because the generator only ever writes hosts.
 *
 * ## What does not travel, and why each one
 *
 * - `id`, because the far side mints its own. What identifies a character across two installs is its
 *   `key`, which is `unique (station_key, key)` and is already what a seeded persona is recognised by.
 * - `active`, because putting somebody on air is a decision about a station rather than a property of
 *   a character. `PersonasService.setActive` is the one path, and it posts the director a `recast`.
 * - `station_key`, which is provenance in the envelope and nothing more: an import writes into
 *   whichever station it is running as, so the two need not match. When `docs/todo/multi-station.md`
 *   lands this is already right rather than a migration.
 * - A story's `origin` and `source`. See {@link storyForFile}.
 * - A story's `lastToldAt` and `timesTold`, which are the rotation on the station that exported it:
 *   what a character IS does not include how often this install has said it out loud.
 * - The notebook (`deadair.persona_notes`). Tier 3 in the design doc, which also names the cost —
 *   *"a character that moves installs arrives with its sheet and no memory"* — and says the console
 *   should say so out loud rather than letting it be discovered.
 */

import type { Persona } from './persona.js';
import type { PersonaStory, PersonaStoryDetail } from './persona.story.js';
import type { PersonaFilePersona, PersonaFileStory, PersonaFileStoryDetail } from './types/personas.types.js';

/**
 * What shape a file is.
 *
 * Stamped and checked, but the check is weak evidence and the parser is told not to lean on it: this
 * repo edits migrations in place rather than superseding them (`CLAUDE.local.md`), so a version stamp
 * cannot promise a shape. What an import actually validates is the shapes; this is for the human
 * reading the failure, and for refusing a file that is plainly something else.
 */
export const PERSONA_FILE_FORMAT = 'deadair.persona/1';

/**
 * The states a story can be in ON THE WAY OUT, which is two of the stored three.
 *
 * `active` is the story. `rejected` travels because it is a decision the operator made, and one the
 * enrichment pass would otherwise re-propose forever on the far side — `deadair.pronunciations`'
 * argument, one table over. `suggested` does not travel, because nobody has decided it: exporting an
 * undecided proposal would hand somebody else a queue of a model's guesses about a character they have
 * never heard.
 */
export const PERSONA_FILE_STORY_STATES = ['active', 'rejected'] as const;

export type PersonaFileStoryState = (typeof PERSONA_FILE_STORY_STATES)[number];

/** Whether a stored state is one a file carries. */
export const travels = (state: string): state is PersonaFileStoryState => (PERSONA_FILE_STORY_STATES as readonly string[]).includes(state);

/**
 * One character, ready to be written to a file.
 *
 * The stories are passed in rather than read here, because this is a pure mapping and the store is a
 * repository: the export service and the phase-2 preview both need the same shape out of different
 * halves, and a mapper that could do I/O would be a second reader of the table.
 */
export function personaForFile(persona: Persona, stories: readonly PersonaStory[]): PersonaFilePersona {
    return {
        key: persona.key,
        label: persona.label,
        style: persona.style,
        ...omitUndefined({
            kind: persona.kind,
            djName: persona.djName,
            voice: persona.voice,
            soundboard: persona.soundboard,
            background: persona.background,
            brevity: persona.brevity,
            latitude: persona.latitude,
            chattiness: persona.chattiness,
            storytelling: persona.storytelling,
            templates: persona.templates,
            diction: mutable(persona.diction),
            dictionMarkers: mutable(persona.dictionMarkers),
            quirks: mutable(persona.quirks),
            preoccupations: mutable(persona.preoccupations),
            catchphrases: mutable(persona.catchphrases),
            avoid: mutable(persona.avoid),
            samples: mutable(persona.samples),
        }),
        // Last, so the file reads the way the character does: the sheet, then what has happened to
        // it. This is the one field here that is a list of objects rather than a line, and a file an
        // operator edits by hand should not have to scroll past it to reach `voice`.
        stories: stories.filter(story => travels(story.state)).map(storyForFile),
    };
}

/**
 * One story, ready to be written to a file.
 *
 * **Neither `origin` nor `source` travels**, and that is one decision rather than two omissions.
 * Whoever exported this stood behind every story in it — accepting a model's proposal is what made it
 * `active` in the first place — so on the far side these are the receiving operator's own, which is
 * exactly what `PersonaStoryWrite` already means by *"always active and always theirs"*. And `source`
 * is a sentence about the catalogue of the station that wrote it (*"from the notes on this record,
 * which this station owns"*), which names a library the receiving install does not have. Carrying
 * either one would put a claim about one station's shelves into another station's character.
 */
function storyForFile(story: PersonaStory): PersonaFileStory {
    return {
        title: story.title,
        story: story.story,
        details: story.details.filter(detail => travels(detail.state)).map(detailForFile),
        // Absent means `active`, so an ordinary story is not carrying a field saying it is ordinary.
        ...(story.state === 'rejected' ? { state: 'rejected' as const } : {}),
    };
}

function detailForFile(detail: PersonaStoryDetail): PersonaFileStoryDetail {
    return {
        detail: detail.detail,
        ...(detail.state === 'rejected' ? { state: 'rejected' as const } : {}),
    };
}

const mutable = (values: readonly string[] | undefined): string[] | undefined => (values === undefined ? undefined : [...values]);

/** Drop the keys that are `undefined`, so an optional field is absent rather than explicitly empty. */
function omitUndefined<T extends Record<string, unknown>>(values: T): Partial<T> {
    return Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined)) as Partial<T>;
}
