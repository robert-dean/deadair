/**
 * What a persona IS, as a record.
 *
 * The sheet ({@link PersonaSheet}) is the half that reaches a prompt. This is the whole thing: the
 * sheet plus everything about a persona that is not said to a model — the name it goes by on air,
 * the voice that speaks it, the phrasings the station falls back to in its words, and what it
 * programmes towards.
 *
 * ## Why the record is wider than the sheet
 *
 * Because a persona that only reached the model would vanish the moment the model declined, which
 * is the ordinary case by design. {@link Persona.templates} is the answer to that: the station's
 * deterministic floor, written in this character, so a station with no model at all still sounds
 * like the one that was chosen.
 */

import type { PersonaSheet } from './persona.sheet.js';

/** A persona as an operator wrote it, before it is a row. */
export interface PersonaDraft extends PersonaSheet {
    /** A stable slug. What a seed is recognised by, and what a log line names. */
    key: string;
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
     * Unset means the plugin's own default, and every seeded persona ships that way: which voices
     * exist is a question only the installed engine can answer, so guessing an id here would ship a
     * warning on every break. An operator picks one from `GET /voices`.
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
    /**
     * What this persona plays, in the operator's words, for the model that chooses records.
     *
     * A description rather than an instruction, which is why a running order's own `brief` beats it
     * where the two disagree: the persona is who the station is and the brief is somebody deciding
     * tonight.
     */
    music?: string;
}

/** A persona as it is stored. */
export interface Persona extends PersonaDraft {
    id: string;
    /** Whether this is the one on air. At most one per station; see the repository's index. */
    active: boolean;
}
