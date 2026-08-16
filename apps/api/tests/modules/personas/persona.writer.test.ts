// The generator's whole value is that it makes a sheet cheap to author, and its whole risk is that
// the sheet it writes is subtly unusable in a way nothing notices until it airs. So most of what is
// tested here is the self-check: a marker no sample carries would decline every break and look
// exactly like a model that is switched off, which is the failure this file exists to catch before
// an operator ever sees it.

import { describe, expect, it } from 'vitest';

import { personaPrompt, readPersona } from '../../../src/modules/personas/persona.writer.js';
import { keepsCharacter } from '../../../src/modules/personas/persona.sheet.js';
import { unknownPlaceholders } from '../../../src/modules/director/break.templates.js';

/** A model answer, as JSON, with whatever the test wants to change about it. */
const answer = (over: Record<string, unknown> = {}): string =>
    JSON.stringify({
        key: 'chipshop',
        label: 'Northern soul DJ',
        style: 'a northern soul DJ broadcasting out of the back of a chip shop',
        djName: 'Sal',
        diction: ["Drop the g from every -ing word", 'Call them love, every time'],
        dictionMarkers: ['love', "in'"],
        quirks: ['Every record is a stomper or it is nothing'],
        catchphrases: ['Keep the faith'],
        avoid: ['vibe'],
        background: 'You have run the same all-nighter since 1974.',
        samples: ["Right then, love, that one's a proper stomper and we're not stoppin'."],
        music: 'Northern soul, stompers, and the odd bit of Motown.',
        templates: "That was {{previous.title}}, love.[[ Comin' up, {{next.artist}}.]]",
        ...over,
    });

describe('the persona prompt', () => {
    it('names the placeholder vocabulary rather than leaving it to be guessed', () => {
        const system = personaPrompt('a northern soul DJ')[0]!.content;

        // A model marked against a list it was never shown is graded on a rubric it cannot read —
        // the same argument that puts the diction markers in a break prompt.
        expect(system).toContain('{{next.title}}');
        expect(system).toContain('{{station.name}}');
        // The kind-specific values belong to the shapes that supply them: a phrasing between two
        // records has no business reading a headline.
        expect(system).not.toContain('{{news.headlines}}');
        expect(system).not.toContain('{{greeting}}');
    });

    it('tells the model markers are frequency rather than novelty', () => {
        // The one instruction a model gets wrong by trying to be helpful, and the reason the check
        // below has to exist even with the instruction present.
        expect(personaPrompt('anything')[0]!.content).toContain('FREQUENCY, not novelty');
    });

    it('asks for the samples BEFORE the markers, which is what makes the markers an extraction', () => {
        const system = personaPrompt('anything')[0]!.content;

        // A model writes JSON keys in the order it was shown them and does not go back, so markers
        // asked for first are invented independently of the lines and then mostly dropped. Measured:
        // a trawlerman offered "ay", "tide" and "port" and kept only "blimey".
        expect(system.indexOf('"samples"')).toBeLessThan(system.indexOf('"dictionMarkers"'));
        expect(system).toContain('Write the samples FIRST');
    });

    it('closes the spelling half, which no check downstream can', () => {
        // "ay" and "aye" are the same marker to an author and different strings to the matcher.
        expect(personaPrompt('anything')[0]!.content).toContain('spelled identically');
    });

    it('rules out the nouns a model reaches for, since "frequent" is not a category it can search', () => {
        const system = personaPrompt('anything')[0]!.content;

        expect(system).toContain('never a noun');
        // The four places a word that recurs in EVERY break actually comes from.
        expect(system).toContain('what this character calls the listener');
    });

    it('carries the description in the user turn, capped', () => {
        const messages = personaPrompt(`${'a'.repeat(5000)}`);

        expect(messages[1]!.role).toBe('user');
        expect(messages[1]!.content.length).toBeLessThan(2100);
    });
});

describe('reading a persona out of an answer', () => {
    it('reads a whole persona and keeps every field', () => {
        const generated = readPersona(answer())!;

        expect(generated.draft.key).toBe('chipshop');
        expect(generated.draft.djName).toBe('Sal');
        expect(generated.draft.samples).toHaveLength(1);
        expect(generated.draft.music).toContain('Northern soul');
    });

    it('reads JSON a model wrapped in prose, and past its thinking', () => {
        const generated = readPersona(`<think>hmm, a chip shop</think>Here you go:\n\n${answer()}\n\nHope that helps!`)!;

        expect(generated.draft.key).toBe('chipshop');
    });

    it('reads an answer whose long string was wrapped across lines', () => {
        // Measured: an answer that stopped cleanly at 1001 tokens, wanted nothing, and was thrown
        // away entirely because a diction rule ran onto a second line. A raw newline inside a JSON
        // string is invalid, and it is a SHAPE failure, which is the half this reader repairs.
        const wrapped = `{
  "key": "chipshop",
  "label": "Chip Shop Soul",
  "style": "a northern soul DJ in the back of a chip shop",
  "diction": [
    "use colloquial contractions,
    drop the g from every verb ending"
  ],
  "samples": ["Right then, love, that one's a proper stomper."],
  "dictionMarkers": ["love"]
}`;

        const generated = readPersona(wrapped)!;

        expect(generated.draft.key).toBe('chipshop');
        // The break is a space, so the two halves do not run together into one word.
        expect(generated.draft.diction).toEqual(['use colloquial contractions, drop the g from every verb ending']);
        expect(generated.draft.dictionMarkers).toEqual(['love']);
    });

    it('answers undefined when there is no object, rather than throwing', () => {
        expect(readPersona('I am afraid I cannot do that.')).toBeUndefined();
        expect(readPersona('{ "key": "broken", ')).toBeUndefined();
    });

    it('refuses an answer missing any of the three fields a row requires', () => {
        expect(readPersona(answer({ style: '' }))).toBeUndefined();
        expect(readPersona(answer({ label: 42 }))).toBeUndefined();
        expect(readPersona(answer({ key: '!!!' }))).toBeUndefined();
    });

    it('drops a field of the wrong type rather than coercing it', () => {
        // A persona is edited by hand straight afterwards, and a half-repaired field is worse to
        // correct than an empty one.
        const generated = readPersona(answer({ quirks: 'not an array', background: 12 }))!;

        expect(generated.draft.quirks).toBeUndefined();
        expect(generated.draft.background).toBeUndefined();
        expect(generated.draft.key).toBe('chipshop');
    });
});

describe('the self-check', () => {
    it('drops a marker the sheet own sample lines never use', () => {
        const generated = readPersona(answer({ dictionMarkers: ['love', 'quomodocunquize'] }))!;

        expect(generated.draft.dictionMarkers).toEqual(['love']);
        expect(generated.droppedMarkers).toEqual(['quomodocunquize']);
    });

    it('leaves a sheet with NO markers rather than refusing it, when none of them survive', () => {
        const generated = readPersona(answer({ dictionMarkers: ['zzyzx', 'floccinaucinihilipilification'] }))!;

        // `keepsCharacter` reads a sheet with no markers as one that made no checkable claim, which
        // is a legitimate persona. A sheet whose every marker is impossible is not.
        expect(generated.draft.dictionMarkers).toBeUndefined();
        expect(keepsCharacter(generated.draft, 'anything at all')).toBe(true);
    });

    it('earns a marker from a sample line that is written but not stored', () => {
        // The stored cap is a decision about how many examples a break writer is shown; whether the
        // character says a word at all is a different question, and the cap knows nothing about it.
        const generated = readPersona(
            answer({
                samples: ['One.', 'Two.', 'Three.', "Right then, love, that's a stomper."],
                dictionMarkers: ['love'],
            }),
        )!;

        expect(generated.draft.samples).toHaveLength(3);
        expect(generated.draft.samples).not.toContain("Right then, love, that's a stomper.");
        expect(generated.draft.dictionMarkers).toEqual(['love']);
        expect(generated.droppedMarkers).toEqual([]);
    });

    it('keeps every marker the samples actually carry', () => {
        const generated = readPersona(answer())!;

        expect(generated.draft.dictionMarkers).toEqual(['love', "in'"]);
        expect(generated.droppedMarkers).toEqual([]);
        // And the check the break writer will run passes against the sheet's own reference line.
        expect(keepsCharacter(generated.draft, generated.draft.samples![0]!)).toBe(true);
    });

    it('drops a broken phrasing BY THE LINE, keeping the ones that work', () => {
        const generated = readPersona(
            answer({ templates: 'That was {{previous.title}}.\nHere comes {{next.album}}.\nYou are with {{station.name}}.' }),
        )!;

        // Five good phrasings and one broken one is five phrasings.
        expect(generated.draft.templates).toBe('That was {{previous.title}}.\nYou are with {{station.name}}.');
        expect(generated.droppedTemplates).toEqual(['Here comes {{next.album}}.']);
    });

    it('leaves the templates unset when every line was broken, so the station phrasings apply', () => {
        const generated = readPersona(answer({ templates: 'Here comes {{next.album}}.' }))!;

        expect(generated.draft.templates).toBeUndefined();
    });

    it('answers phrasings the template renderer will actually accept', () => {
        const generated = readPersona(answer())!;

        for (const line of (generated.draft.templates ?? '').split('\n')) {
            expect(unknownPlaceholders(line)).toEqual([]);
        }
    });
});
