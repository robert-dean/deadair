// What a character loses on the way into a file, and what it must not.
//
// Every case here is one that fails SILENTLY if it regresses. An `id` that travelled would restore
// onto nothing on the far side and look like an import that worked; an `active` that travelled would
// change who is presenting on somebody else's station; a `suggested` story that travelled would hand
// a stranger a queue of a model's guesses about a character they have never heard. None of the three
// throws, and none of them is visible in the file unless somebody reads it.

import { describe, expect, it } from 'vitest';

import { personaForFile, PERSONA_FILE_FORMAT, travels } from '../../../src/modules/personas/persona.file.js';
import type { Persona } from '../../../src/modules/personas/persona.js';
import type { PersonaStory } from '../../../src/modules/personas/persona.story.js';

const persona = (over: Partial<Persona> = {}): Persona => ({
    id: '9f1d0a5e-0000-4000-8000-000000000001',
    key: 'overnight',
    kind: 'host',
    label: 'The overnight host',
    style: 'a voice for the small hours',
    active: false,
    ...over,
});

const story = (over: Partial<PersonaStory> = {}): PersonaStory => ({
    id: 'a1',
    personaKey: 'overnight',
    title: 'The Barstow lights',
    story: 'Three of them, over the desert, and nobody else on the road.',
    state: 'active',
    origin: 'operator',
    details: [],
    timesTold: 0,
    createdAt: '2026-08-01T00:00:00.000Z',
    ...over,
});

describe('personaForFile', () => {
    it('carries the sheet', () => {
        const file = personaForFile(
            persona({
                djName: 'Vega',
                voice: 'overnight',
                soundboard: 'station',
                diction: ['drop the g'],
                dictionMarkers: ['friend'],
                quirks: ['never explains a record'],
                templates: 'That was {{previous.title}}.',
                brevity: 'short',
                latitude: 'loose',
                storytelling: 'often',
            }),
            [],
        );

        expect(file).toMatchObject({
            key: 'overnight',
            kind: 'host',
            label: 'The overnight host',
            style: 'a voice for the small hours',
            djName: 'Vega',
            voice: 'overnight',
            soundboard: 'station',
            diction: ['drop the g'],
            dictionMarkers: ['friend'],
            quirks: ['never explains a record'],
            templates: 'That was {{previous.title}}.',
            brevity: 'short',
            latitude: 'loose',
            storytelling: 'often',
        });
    });

    // The two the whole design rests on. `PersonaDraftView` omits them at the contract, so this is
    // the mapper agreeing with it rather than a second enforcement — but a mapper that spread the
    // row would type-check and would put both back.
    it('never carries the row id or who is on air', () => {
        const file = personaForFile(persona({ active: true }), []);

        expect(file).not.toHaveProperty('id');
        expect(file).not.toHaveProperty('active');
    });

    // A caller is shareable exactly as a host is, and `kind` is what says which. It travelling
    // wrongly would be a phone-in voice arriving as a presenter the far side can put on air.
    it('carries what a character is for', () => {
        expect(personaForFile(persona({ kind: 'caller' }), [])).toMatchObject({ kind: 'caller' });
    });

    // An absent optional is absent rather than explicitly empty, so a round trip does not turn "the
    // plugin's default voice" into "a voice called nothing".
    it('leaves an unset field out rather than sending it empty', () => {
        const file = personaForFile(persona(), []);

        expect(file).not.toHaveProperty('voice');
        expect(file).not.toHaveProperty('soundboard');
        expect(file).not.toHaveProperty('templates');
    });

    it('copies the lists rather than sharing them', () => {
        const source = persona({ quirks: ['never explains a record'] });
        const file = personaForFile(source, []);

        expect(file.quirks).not.toBe(source.quirks);
        expect(file.quirks).toEqual(['never explains a record']);
    });
});

describe('the stories a file carries', () => {
    it('carries an active story with no state on it, since active is what a story ordinarily is', () => {
        const [carried] = personaForFile(persona(), [story()]).stories;

        expect(carried).toEqual({
            title: 'The Barstow lights',
            story: 'Three of them, over the desert, and nobody else on the road.',
            details: [],
        });
    });

    // The half that keeps the enrichment pass from re-proposing on the far side what the operator
    // already turned down here. `deadair.pronunciations`' argument, one table over.
    it('carries a rejected story, marked', () => {
        const [carried] = personaForFile(persona(), [story({ state: 'rejected' })]).stories;

        expect(carried?.state).toBe('rejected');
    });

    it('leaves an undecided proposal behind entirely', () => {
        const file = personaForFile(persona(), [story({ state: 'suggested' })]);

        expect(file.stories).toEqual([]);
    });

    // Both are a claim about the station that exported the file: `origin` says a model here wrote it,
    // and `source` names a record in THIS library. Neither is true of the character on the far side.
    it('carries neither where a story came from nor what suggested it', () => {
        const [carried] = personaForFile(persona(), [story({ origin: 'model', source: 'from the notes on a record this station owns' })]).stories;

        expect(carried).not.toHaveProperty('origin');
        expect(carried).not.toHaveProperty('source');
    });

    // The rotation belongs to the station that told it, not to the character.
    it('carries nothing about how often this station has told it', () => {
        const [carried] = personaForFile(persona(), [story({ timesTold: 9, lastToldAt: '2026-08-20T00:00:00.000Z' })]).stories;

        expect(carried).not.toHaveProperty('timesTold');
        expect(carried).not.toHaveProperty('lastToldAt');
    });

    it("carries a story's details, sieved the same way the stories are", () => {
        const [carried] = personaForFile(persona(), [
            story({
                details: [
                    { id: 'd1', storyId: 'a1', detail: 'the third one held still', state: 'active', origin: 'operator', createdAt: '2026-08-02' },
                    { id: 'd2', storyId: 'a1', detail: 'a model made this up', state: 'suggested', origin: 'model', createdAt: '2026-08-03' },
                    { id: 'd3', storyId: 'a1', detail: 'turned down', state: 'rejected', origin: 'model', createdAt: '2026-08-04' },
                ],
            }),
        ]).stories;

        expect(carried?.details).toEqual([{ detail: 'the third one held still' }, { detail: 'turned down', state: 'rejected' }]);
    });
});

describe('travels', () => {
    it('is the two decided states and nothing else', () => {
        expect(travels('active')).toBe(true);
        expect(travels('rejected')).toBe(true);
        expect(travels('suggested')).toBe(false);
    });
});

describe('the format stamp', () => {
    // Weak evidence by design — this repo edits migrations in place, so a version cannot promise a
    // shape — but it has to be stable, or every file already written stops being readable.
    it('is the version an import will recognise', () => {
        expect(PERSONA_FILE_FORMAT).toBe('deadair.persona/1');
    });
});
