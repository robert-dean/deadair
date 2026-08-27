/**
 * What importing a file would do to this station.
 *
 * Pure — a file and a snapshot of what this station holds in, a plan out — so every decision here is
 * testable without a database, exactly as `break.prompt.ts` and `persona.writer.ts` are. Reading the
 * station is the service's job; deciding is this one's.
 *
 * ## Why it is a separate step at all
 *
 * The import runs it and answers with it, and the preview route runs it and writes nothing. So a
 * plan is not a forecast that could be wrong: it is the decision itself, made once, shown to the
 * operator, and then carried out. That is the whole reason `docs/todo/backup-and-restore.md` insists
 * the dry run be "keyed exactly the way the real pass will key it, by the same code" — a second
 * implementation that agrees today is a second implementation.
 *
 * ## Notices are reported and never enforced
 *
 * Every one of the four content notices describes a state this station can be in perfectly well. A
 * voice its engine does not map falls back and warns once; a `soundboard` naming no rack is — by
 * migration 0012's own argument — the same state as a presenter with no rack at all; an unusable
 * phrasing costs one line out of a pool; an unearned marker makes the character checked more loosely
 * than its author intended. **None of them is a reason to refuse somebody's writing.** What they have
 * in common is that each is otherwise discovered by putting the character on air, which for the
 * marker one means an evening of every model break declining and looking exactly like a model that is
 * switched off.
 *
 * The judgements themselves are borrowed rather than written here, and that is load-bearing:
 * `unusablePhrasing` and `unearnedMarkers` are the same functions `persona.writer.ts` uses to DROP
 * from a model's answer. Two copies of those rules would be two things that can disagree about
 * whether a character works, and both of them are invisible in production.
 */

import { phrasingLines, unusablePhrasing } from '#modules/director/break.templates.js';
import { unearnedMarkers } from './persona.sheet.js';
import { PERSONA_FILE_FORMAT } from './persona.file.js';
import type { PersonaFile, PersonaFilePersona, PersonaImportEntry, PersonaImportNotice, PersonaImportPlan } from './types/personas.types.js';

/**
 * What this station holds, as much of it as a plan needs.
 *
 * A snapshot passed in rather than repositories injected, so this file stays pure. The three lists
 * are deliberately shaped as what the caller can cheaply get: the personas it already has, the
 * stories each of them holds, and the two vocabularies a sheet can point at.
 */
export interface StationSnapshot {
    /**
     * Every persona key this station holds: what it is called, whether it is presenting, and which
     * of its optional sheet fields are filled in.
     *
     * The last of those is what {@link SHEET_FIELDS} is for. An update REPLACES the sheet, so a field
     * the file leaves out is a field this station loses, and "Rewrite" on its own does not say that.
     */
    personas: ReadonlyMap<string, { label: string; active: boolean; filled: ReadonlySet<string> }>;
    /** Story handles per persona key, lower-cased and trimmed, with the details each already holds. */
    stories: ReadonlyMap<string, ReadonlyMap<string, ReadonlySet<string>>>;
    /**
     * The station voice ids the installed engine maps, or `undefined` when nothing can speak.
     *
     * The distinction is the whole of it. `undefined` is a station with no speech plugin, which is
     * an ordinary state — reporting every voice in the file as unmappable there would be a page of
     * notices about a decision nobody has made yet. An empty SET is an engine that answered and
     * named nothing, which is a real mismatch.
     */
    voices?: ReadonlySet<string>;
    /**
     * The pad set keys this station holds, or `undefined` when they could not be read.
     *
     * Optional for the reason above and NOT for the same case: an empty set is a station with no
     * racks, which is true and worth saying. `undefined` is a read that failed, where an empty set
     * would turn one unavailable table into a notice on every character in the file claiming this
     * station has no soundboards at all.
     */
    soundboards?: ReadonlySet<string>;
}

/**
 * The optional fields of a sheet, and what each one is called to somebody reading a warning.
 *
 * `key`, `label` and `style` are not here because they are required: a file always carries them, so
 * they can never be the thing an update quietly takes away. Everything else can.
 */
export const SHEET_FIELDS: ReadonlyArray<readonly [keyof PersonaFilePersona, string]> = [
    ['djName', 'the name it goes by on air'],
    ['voice', 'its voice'],
    ['soundboard', 'its soundboard'],
    ['background', 'its background'],
    ['brevity', 'how much it says'],
    ['latitude', 'how much room it is given'],
    ['storytelling', 'how readily it tells a story'],
    ['templates', 'its own phrasings'],
    ['diction', 'its diction'],
    ['dictionMarkers', 'its diction markers'],
    ['quirks', 'its quirks'],
    ['preoccupations', 'its preoccupations'],
    ['catchphrases', 'its catchphrases'],
    ['avoid', 'the wording it avoids'],
    ['samples', 'its sample lines'],
];

/** Which of {@link SHEET_FIELDS} a sheet actually has something in. An empty list is not a value. */
export function filledFields(sheet: Partial<Record<keyof PersonaFilePersona, unknown>>): Set<string> {
    return new Set(
        SHEET_FIELDS.filter(([field]) => {
            const value = sheet[field];
            if (value === undefined) return false;
            if (Array.isArray(value)) return value.length > 0;

            return String(value).trim().length > 0;
        }).map(([field]) => field),
    );
}

/** Match a story handle the way the store's own partial unique index does. */
export const storyHandle = (title: string): string => title.trim().toLowerCase();

/** Match a detail the way `PersonaStoriesRepository.holdsDetail` does. */
export const detailHandle = (detail: string): string => detail.trim().toLowerCase();

/** What importing this file would do here. */
export function planImport(file: PersonaFile, station: StationSnapshot): PersonaImportPlan {
    return {
        format: file.format,
        notices: fileNotices(file),
        personas: file.personas.map(persona => entryFor(persona, station)),
        ...(file.station === undefined ? {} : { station: file.station }),
        ...(file.takenAt === undefined ? {} : { takenAt: file.takenAt }),
    };
}

/**
 * What is worth saying about the FILE rather than about any character in it.
 *
 * Two things, and the second is the one that would otherwise be silent. A key appearing twice means
 * the later entry wins and the earlier one is simply lost — no error, no row, nothing in a log — so
 * an operator who concatenated two exports by hand would get one character fewer than they counted
 * and no way to notice.
 */
function fileNotices(file: PersonaFile): PersonaImportNotice[] {
    const notices: PersonaImportNotice[] = [];

    // Said and never enforced, on the design's own terms: migrations here are edited in place rather
    // than superseded, so a version stamp cannot promise a shape and the shapes are what the
    // contract already validated. This is for the person reading a result that surprised them.
    if (file.format !== PERSONA_FILE_FORMAT) {
        notices.push({
            kind: 'format',
            message: `this file says it is "${file.format}" and this station writes "${PERSONA_FILE_FORMAT}". Everything in it still validated, so it will import — but if something comes out wrong, that is the first thing to look at`,
        });
    }

    const seen = new Set<string>();
    const twice = new Set<string>();
    for (const persona of file.personas) {
        if (seen.has(persona.key)) twice.add(persona.key);
        seen.add(persona.key);
    }

    for (const key of twice) {
        notices.push({
            kind: 'duplicate',
            message: `this file carries more than one character called "${key}". The last one in the file is the one that would land, and the others would be lost without a trace`,
        });
    }

    return notices;
}

function entryFor(persona: PersonaFilePersona, station: StationSnapshot): PersonaImportEntry {
    const held = station.personas.get(persona.key);
    const heldStories = station.stories.get(persona.key) ?? new Map<string, ReadonlySet<string>>();

    let storiesNew = 0;
    let storiesHeld = 0;
    let detailsNew = 0;
    let detailsHeld = 0;

    for (const story of persona.stories) {
        const heldDetails = heldStories.get(storyHandle(story.title));
        if (heldDetails === undefined) {
            storiesNew += 1;
            // A story this station does not hold has no details here either, so every one of its
            // details is new. Counted rather than assumed, because a file may legitimately carry a
            // story with none.
            detailsNew += story.details.length;
            continue;
        }

        storiesHeld += 1;
        for (const detail of story.details) {
            if (heldDetails.has(detailHandle(detail.detail))) detailsHeld += 1;
            else detailsNew += 1;
        }
    }

    return {
        key: persona.key,
        label: persona.label,
        outcome: held === undefined ? 'create' : 'update',
        storiesNew,
        storiesHeld,
        detailsNew,
        detailsHeld,
        notices: personaNotices(persona, station, held),
        ...(persona.kind === undefined ? {} : { kind: persona.kind }),
    };
}

function personaNotices(
    persona: PersonaFilePersona,
    station: StationSnapshot,
    held: { label: string; active: boolean; filled: ReadonlySet<string> } | undefined,
): PersonaImportNotice[] {
    const notices: PersonaImportNotice[] = [];

    // An update REPLACES the sheet, so a field this station has filled in and the file leaves out is
    // one that goes. "Rewrite" does not say that on its own, and this is the only loss an import can
    // cause: everything else about a merge is additive, stories included. Named field by field rather
    // than as a warning about updates in general, because which fields matter is the operator's
    // judgement — losing a djName is nothing and losing eight sample lines is the character.
    if (held !== undefined) {
        const carried = filledFields(persona);
        const lost = SHEET_FIELDS.filter(([field]) => held.filled.has(field) && !carried.has(field)).map(([, name]) => name);

        if (lost.length > 0) {
            notices.push({
                kind: 'clears',
                message: `this file says nothing about ${list(lost)}, and an import replaces the sheet — so what is here now would go`,
            });
        }
    }

    // First, because it is the one an operator most needs to see before pressing anything: this
    // rewrites the sheet the station is currently speaking from. Not a fault and not refused — the
    // change is heard on the next break, exactly as an ordinary edit is.
    if (held?.active === true) {
        notices.push({
            kind: 'on-air',
            message: `"${held.label}" is on air, and this would rewrite the character the station is speaking in right now. The change is heard on the next break`,
        });
    }

    // Only where something can actually speak. A station with no speech plugin has made no decision
    // for this to disagree with, and a notice on every character would be noise about an absence the
    // voices page already reports.
    if (persona.voice !== undefined && station.voices !== undefined && !station.voices.has(persona.voice)) {
        notices.push({
            kind: 'voice',
            message: `nothing here maps the voice "${persona.voice}", so this character would speak in the engine's default until it is mapped or changed`,
        });
    }

    // Migration 0012 settles the shape of this: a persona naming a set that does not exist and one
    // with no rack at all are ONE state, answered identically, "because both are a presenter with
    // nothing to reach for". So it is said and never refused.
    if (persona.soundboard !== undefined && station.soundboards !== undefined && !station.soundboards.has(persona.soundboard)) {
        notices.push({
            kind: 'soundboard',
            message: `this station has no soundboard called "${persona.soundboard}", so this character would work without one until a rack of that name exists`,
        });
    }

    // By the LINE, because five good phrasings and one broken one is five phrasings — the same
    // arithmetic `persona.writer.ts` does, reported instead of applied. A file's phrasings are
    // somebody's writing, and which of these to fix and which to lose is their call.
    const unusable = phrasingLines(persona.templates).filter(line => unusablePhrasing(line) !== undefined);
    for (const line of unusable) {
        notices.push({ kind: 'phrasing', message: `the phrasing "${trimmed(line)}" would never be used here, because ${unusablePhrasing(line)}` });
    }

    // The one check on a character nothing downstream can make in time to matter.
    const unearned = unearnedMarkers(persona.dictionMarkers, persona.samples);
    if (unearned.length > 0) {
        notices.push({
            kind: 'markers',
            message: `${unearned.map(marker => `"${marker}"`).join(', ')} ${unearned.length === 1 ? 'is listed as a word that proves this character but no sample line uses it' : 'are listed as words that prove this character but no sample line uses any of them'}, so a break would be checked more loosely than the sheet intends`,
        });
    }

    return notices;
}

/** A line short enough to sit inside a sentence, since a phrasing can be most of a paragraph. */
const trimmed = (line: string): string => (line.length <= 80 ? line : `${line.slice(0, 79)}…`);

/** Several things as a person would say them, because these sentences are read rather than parsed. */
function list(items: readonly string[]): string {
    if (items.length <= 1) return items[0] ?? '';
    return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}
