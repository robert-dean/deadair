// What a file would do here, and the four things this station cannot honour about it.
//
// The plan is the decision rather than a forecast of it — the import runs this same function — so a
// wrong answer here is a wrong import, not a misleading preview. And every notice it can raise
// describes a failure that is otherwise invisible until the character is on air: an unmapped voice
// is heard rather than reported, an unusable phrasing is simply never picked, and a marker no sample
// line uses makes every model break decline in a way indistinguishable from a model that is off.

import { describe, expect, it } from 'vitest';

import { planImport, type StationSnapshot } from '../../../src/modules/personas/persona.file.plan.js';
import { PERSONA_FILE_FORMAT } from '../../../src/modules/personas/persona.file.js';
import type { PersonaFile, PersonaFilePersona, PersonaFileStory } from '../../../src/modules/personas/types/personas.types.js';

/** The telling itself is never what this file is about, so every case gets the same one. */
const story = (title: string, details: string[] = []): PersonaFileStory => ({
    title,
    story: 'Something happened, and here is how it went.',
    details: details.map(detail => ({ detail })),
});

const entry = (over: Partial<PersonaFilePersona> = {}): PersonaFilePersona => ({
    key: 'overnight',
    label: 'The overnight host',
    style: 'a voice for the small hours',
    stories: [],
    ...over,
});

const file = (personas: PersonaFilePersona[], over: Partial<PersonaFile> = {}): PersonaFile => ({
    format: PERSONA_FILE_FORMAT,
    takenAt: '2026-08-27T00:00:00.000Z',
    personas,
    ...over,
});

/** A station holding nothing, which is what a fresh install looks like to this. */
const empty = (over: Partial<StationSnapshot> = {}): StationSnapshot => ({
    personas: new Map(),
    stories: new Map(),
    soundboards: new Set(),
    ...over,
});

const kinds = (notices: readonly { kind: string }[]): string[] => notices.map(notice => notice.kind);

/**
 * A character this station already holds.
 *
 * `filled` is which of its optional sheet fields have something in them, which is what decides
 * whether an update would quietly clear one. Empty by default, so a case that is not about that says
 * nothing about it.
 */
const holding = (label: string, active = false, filled: string[] = []) => ({ label, active, filled: new Set(filled) });

describe('what would happen to each character', () => {
    it('creates a key this station does not hold', () => {
        const plan = planImport(file([entry()]), empty());

        expect(plan.personas[0]).toMatchObject({ key: 'overnight', label: 'The overnight host', outcome: 'create' });
    });

    it('updates a key it does', () => {
        const station = empty({ personas: new Map([['overnight', holding('Whoever this is')]]) });

        expect(planImport(file([entry()]), station).personas[0]?.outcome).toBe('update');
    });

    // The counts are what an operator reads to decide whether a file is worth importing, and the
    // held/new split is what says an import is additive rather than a replacement.
    it('counts a story this station already holds separately from a new one', () => {
        const station = empty({
            personas: new Map([['overnight', holding('The overnight host')]]),
            stories: new Map([['overnight', new Map([['the barstow lights', new Set<string>()]])]]),
        });
        const plan = planImport(
            file([
                entry({
                    stories: [story('The Barstow lights'), story('The pressing that plays itself')],
                }),
            ]),
            station,
        );

        expect(plan.personas[0]).toMatchObject({ storiesHeld: 1, storiesNew: 1 });
    });

    // Matched the way the store's own partial unique index matches it, or the preview would promise
    // a story the import is then going to skip.
    it('matches a story handle case-insensitively and untrimmed, as the store does', () => {
        const station = empty({
            personas: new Map([['overnight', holding('x')]]),
            stories: new Map([['overnight', new Map([['the barstow lights', new Set<string>()]])]]),
        });
        const plan = planImport(file([entry({ stories: [story('  The BARSTOW Lights ')] })]), station);

        expect(plan.personas[0]).toMatchObject({ storiesHeld: 1, storiesNew: 0 });
    });

    it('counts every detail of a new story as new, because this station holds none of them', () => {
        const plan = planImport(file([entry({ stories: [story('The Barstow lights', ['a', 'b'])] })]), empty());

        expect(plan.personas[0]).toMatchObject({ storiesNew: 1, detailsNew: 2, detailsHeld: 0 });
    });

    it('splits the details of a story it already holds', () => {
        const station = empty({
            personas: new Map([['overnight', holding('x')]]),
            stories: new Map([['overnight', new Map([['the barstow lights', new Set(['the third one held still'])]])]]),
        });
        const plan = planImport(file([entry({ stories: [story('The Barstow lights', ['The third one held still', 'new'])] })]), station);

        expect(plan.personas[0]).toMatchObject({ storiesHeld: 1, detailsHeld: 1, detailsNew: 1 });
    });
});

describe('what is worth saying about the file', () => {
    it('says nothing about a file this build wrote', () => {
        expect(planImport(file([entry()]), empty()).notices).toEqual([]);
    });

    // Reported and never enforced: migrations here are edited in place, so the stamp cannot promise
    // a shape and the shape is what the contract already validated.
    it('names a format it does not recognise without refusing it', () => {
        const plan = planImport(file([entry()], { format: 'deadair.persona/9' }), empty());

        expect(kinds(plan.notices)).toEqual(['format']);
        expect(plan.personas).toHaveLength(1);
    });

    // The silent one. A repeated key means the later entry wins and the earlier is lost with no
    // error, no row and nothing in a log — which is what somebody who concatenated two exports gets.
    it('names a key the file carries twice, because the earlier one would be lost without a trace', () => {
        const plan = planImport(file([entry(), entry({ label: 'A different sheet' })]), empty());

        expect(kinds(plan.notices)).toEqual(['duplicate']);
        expect(plan.notices[0]?.message).toContain('overnight');
    });
});

describe('what this station cannot honour', () => {
    it('says when a file would rewrite the character on air', () => {
        const station = empty({ personas: new Map([['overnight', holding('The overnight host', true)]]) });

        expect(kinds(planImport(file([entry()]), station).personas[0]!.notices)).toEqual(['on-air']);
    });

    it('says nothing about a character that is merely held', () => {
        const station = empty({ personas: new Map([['overnight', holding('x')]]) });

        expect(planImport(file([entry()]), station).personas[0]?.notices).toEqual([]);
    });

    // The only LOSS an import can cause, and the one "Rewrite" does not say on its own: an update
    // replaces the sheet, so a field this station has filled in and the file leaves out is a field
    // that goes. Everything else about a merge is additive, stories included.
    it('names what an update would clear, field by field', () => {
        const station = empty({ personas: new Map([['overnight', holding('x', false, ['samples', 'templates'])]]) });
        const notices = planImport(file([entry()]), station).personas[0]!.notices;

        expect(kinds(notices)).toEqual(['clears']);
        expect(notices[0]?.message).toContain('its own phrasings');
        expect(notices[0]?.message).toContain('its sample lines');
    });

    it('says nothing about a field the file carries', () => {
        const station = empty({ personas: new Map([['overnight', holding('x', false, ['samples'])]]) });

        expect(planImport(file([entry({ samples: ['Stay up.'] })]), station).personas[0]?.notices).toEqual([]);
    });

    // An empty list is not a value. A file carrying `samples: []` is a file saying nothing about
    // samples, which is exactly what an export of a character with none produces.
    it('treats an empty list in the file as saying nothing', () => {
        const station = empty({ personas: new Map([['overnight', holding('x', false, ['samples'])]]) });

        expect(kinds(planImport(file([entry({ samples: [] })]), station).personas[0]!.notices)).toEqual(['clears']);
    });

    it('says nothing about clearing when the character is new here', () => {
        expect(planImport(file([entry()]), empty()).personas[0]?.notices).toEqual([]);
    });

    it('names a voice the engine does not map', () => {
        const station = empty({ voices: new Set(['classic']) });
        const notices = planImport(file([entry({ voice: 'overnight' })]), station).personas[0]!.notices;

        expect(kinds(notices)).toEqual(['voice']);
        expect(notices[0]?.message).toContain('overnight');
    });

    it('says nothing about a voice the engine does map', () => {
        expect(planImport(file([entry({ voice: 'classic' })]), empty({ voices: new Set(['classic']) })).personas[0]?.notices).toEqual([]);
    });

    // The case that would otherwise turn a station with no speech plugin into a page of complaints
    // about a decision nobody has made. `undefined` is "this station has said nothing about voices",
    // which covers both nothing installed and an engine that could not be asked.
    it('says nothing about any voice when nothing can speak', () => {
        expect(planImport(file([entry({ voice: 'overnight' })]), empty()).personas[0]?.notices).toEqual([]);
    });

    it('names a soundboard this station does not hold', () => {
        const notices = planImport(file([entry({ soundboard: 'overnight' })]), empty({ soundboards: new Set(['station']) })).personas[0]!.notices;

        expect(kinds(notices)).toEqual(['soundboard']);
    });

    // The same distinction as voices, for the opposite reason: an EMPTY set is a real answer worth a
    // notice, and `undefined` is a read that failed and must not be reported as one.
    it('says nothing about a soundboard when the racks could not be read', () => {
        const station: StationSnapshot = { personas: new Map(), stories: new Map() };

        expect(planImport(file([entry({ soundboard: 'overnight' })]), station).personas[0]?.notices).toEqual([]);
    });

    it('names a phrasing this station could never fill', () => {
        const notices = planImport(file([entry({ templates: 'That was {{previous.title}}.\nUp next: {{next.titel}}.' })]), empty()).personas[0]!
            .notices;

        expect(kinds(notices)).toEqual(['phrasing']);
        expect(notices[0]?.message).toContain('{{next.titel}}');
    });

    // A lone bracket is TEXT that reaches the script and gets read out, and it is invisible to a
    // placeholder check because that only ever inspects `{{…}}`.
    it('names a phrasing carrying a single bracket', () => {
        const notices = planImport(file([entry({ templates: '[Mate] That was {{previous.title}}.' })]), empty()).personas[0]!.notices;

        expect(kinds(notices)).toEqual(['phrasing']);
        expect(notices[0]?.message).toContain('bracket');
    });

    it('names a phrasing that says nothing about the records', () => {
        const notices = planImport(file([entry({ templates: 'And we roll on.' })]), empty()).personas[0]!.notices;

        expect(kinds(notices)).toEqual(['phrasing']);
    });

    it('ignores a comment and a blank line, as the writer that reads them does', () => {
        expect(
            planImport(file([entry({ templates: '# turned off for now\n\nThat was {{previous.title}}.' })]), empty()).personas[0]?.notices,
        ).toEqual([]);
    });

    it('names markers no sample line uses', () => {
        const notices = planImport(file([entry({ dictionMarkers: ['friend', 'brother'], samples: ['Stay up, friend.'] })]), empty()).personas[0]!
            .notices;

        expect(kinds(notices)).toEqual(['markers']);
        expect(notices[0]?.message).toContain('brother');
        expect(notices[0]?.message).not.toContain('"friend"');
    });

    it('says nothing when every marker is earned', () => {
        expect(planImport(file([entry({ dictionMarkers: ['friend'], samples: ['Stay up, friend.'] })]), empty()).personas[0]?.notices).toEqual([]);
    });

    // A sheet with no markers made no checkable claim, which `keepsCharacter` already treats as a
    // character that passes everything. Reporting it would be complaining about an author who filled
    // in fewer boxes.
    it('says nothing about a sheet that claims no markers at all', () => {
        expect(planImport(file([entry({ samples: ['Stay up, friend.'] })]), empty()).personas[0]?.notices).toEqual([]);
    });

    it('reports every notice a character earns rather than the first', () => {
        const notices = planImport(
            file([entry({ voice: 'nope', soundboard: 'nope', templates: 'And we roll on.', dictionMarkers: ['brother'], samples: ['Stay up.'] })]),
            empty({ voices: new Set(['classic']), soundboards: new Set(['station']) }),
        ).personas[0]!.notices;

        expect(kinds(notices)).toEqual(['voice', 'soundboard', 'phrasing', 'markers']);
    });
});

describe('the envelope', () => {
    it('carries what the file said about itself back to the reader', () => {
        const plan = planImport(file([entry()], { station: 'elsewhere' }), empty());

        expect(plan).toMatchObject({ format: PERSONA_FILE_FORMAT, station: 'elsewhere', takenAt: '2026-08-27T00:00:00.000Z' });
    });

    it('leaves out what the file did not say', () => {
        const plan = planImport({ format: PERSONA_FILE_FORMAT, takenAt: '2026-08-27T00:00:00.000Z', personas: [] }, empty());

        expect(plan).not.toHaveProperty('station');
        expect(plan.personas).toEqual([]);
    });
});
