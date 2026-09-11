/**
 * What a persona IS, as a record.
 *
 * The sheet ({@link PersonaSheet}) is the half that reaches a prompt. This is the whole thing: the
 * sheet plus everything about a persona that is not said to a model — the name it goes by on air,
 * the voice that speaks it, and the phrasings the station falls back to in its own words.
 *
 * ## Why the record is wider than the sheet
 *
 * Because a persona that only reached the model would vanish the moment the model declined, which
 * is the ordinary case by design. {@link Persona.templates} is the answer to that: the station's
 * deterministic floor, written in this character, so a station with no model at all still sounds
 * like the one that was chosen.
 *
 * ## A persona is a VOICE, and says nothing about what the station plays
 *
 * There was a `music` line here, handed to `ModelSetGenerator` so that choosing a character chose
 * the programming too. It is gone, and what it cost is worth recording so it is not reinvented.
 *
 * It was a FOURTH way to say what the station should play, beside the three that are keyed to the
 * clock — `station_lineup.brief` for this broadcast, `schedule_slots.brief` for this stretch of the
 * day, and `schedule.sustainingBrief` for the standing default. Two prose descriptions of the music
 * reaching one local model produced the obvious result: handed "long, strange and deliberate deep
 * cuts" AND "80s synthpop" it split the difference, so the `music` line had to be WITHHELD from any
 * refill that carried a brief. That rule was load-bearing, it was a page of explanation, and
 * deleting the field deletes it: there is now one place an operator says what to play, and a
 * persona is purely who says it.
 */

import type { PersonaSheet } from './persona.sheet.js';

/**
 * What a character is FOR.
 *
 * `host` is the station's own voice, and everything about a persona was written for one. `caller` is
 * somebody who phones in to a production: cast per programme, never on air by themselves, and never
 * the station — which is why the database refuses an active one rather than trusting every writer of
 * the column to remember.
 *
 * A closed list rather than free text, unlike `segments.kind`, because each value is a rule the code
 * has to know how to apply. [personas](https://github.com/robert-dean/deadair/discussions/25) §1's newsreader is the next entry.
 */
export const PERSONA_KINDS = ['host', 'caller'] as const;

/** One of {@link PERSONA_KINDS}. */
export type PersonaKind = (typeof PERSONA_KINDS)[number];

/** What a persona is when nobody said: the station's own voice, which is what the table held before callers. */
export const DEFAULT_PERSONA_KIND: PersonaKind = 'host';

/** Whether a stored or submitted value is one this code knows how to apply. */
export const isPersonaKind = (value: unknown): value is PersonaKind => PERSONA_KINDS.includes(value as PersonaKind);

/** A persona as an operator wrote it, before it is a row. */
export interface PersonaDraft extends PersonaSheet {
    /** A stable slug. What a seed is recognised by, and what a log line names. */
    key: string;
    /**
     * What this character is for, and it is required rather than optional.
     *
     * The column is `not null` with a default, so every row has one, and a draft that omitted it
     * would be a draft nobody could classify: `host` and "not stated" would be the same thing right
     * up until somebody wrote a caller and forgot.
     */
    kind: PersonaKind;
    /** What the console calls it. */
    label: string;
    /**
     * Completes "You are …" in a system prompt.
     *
     * WHO they are; the sheet carries HOW they talk. Keep it a presenter rather than a different
     * job: a persona is the station's voice, not a second thing the station does.
     */
    style: string;
    /**
     * The name this character goes by on air, overriding `station.djName` while it is active.
     *
     * Unset means the station's own, which is the right default for a persona that is a manner
     * rather than a character — a warm daytime host has no reason to rename the presenter.
     */
    djName?: string;
    /**
     * The station voice that speaks this persona, as the opaque id a speech plugin maps.
     *
     * Unset means the plugin's own default. Every seeded persona used to ship that way, on the
     * grounds that which voices exist is a question only the installed engine can answer — true of
     * an ENGINE id and not of a STATION one, which is what this actually holds. Both bundled speech
     * plugins now ship a map covering every seeded persona's key, so a seed naming its own key
     * resolves on either engine and switching between them rewrites nothing.
     *
     * The measured cost of the old rule was the whole point: nineteen written characters, every one
     * of them read in the same voice, with nothing on any page saying that was a default rather than
     * a decision.
     *
     * An id with no row behind it still falls back and still warns once, which is what makes
     * deleting a row from the map an expressible thing to do rather than a way to break a persona.
     * An operator picks one from `GET /voices`.
     */
    voice?: string;
    /**
     * This character's own break phrasings, one per line, in the syntax of
     * `rotation.breakTemplates`.
     *
     * The floor, in character. Empty means the station's global phrasings, which is exactly right
     * for a persona whose voice is a manner rather than a dialect.
     */
    templates?: string;
}

/** A persona as it is stored. */
export interface Persona extends PersonaDraft {
    id: string;
    /** Whether this is the one on air. At most one per station; see the repository's index. */
    active: boolean;
}
