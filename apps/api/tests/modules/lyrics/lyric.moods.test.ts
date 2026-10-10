// The mood judgement's prompt and its parse. A distribution, normalised; "could not tell" as its own
// answer; anything else as nothing.

import { describe, expect, it } from 'vitest';

import {
    LYRIC_MOODS,
    MAX_MOOD_STAGES,
    MAX_PROMPT_LYRIC_CHARS,
    moodsField,
    moodStages,
    moodsPrompt,
    MOODS_VERSION,
    readMoods,
} from '../../../src/modules/lyrics/lyric.moods.js';

const subject = { title: 'Glory Box', artist: 'Portishead', album: 'Dummy', year: 1994 };

describe('readMoods', () => {
    it('reads the seven shares and makes them add up to one', () => {
        const moods = readMoods('{"moods":{"love":2,"sadness":2}}');
        expect(moods).toMatchObject({ love: 0.5, sadness: 0.5, happiness: 0 });
        expect(Object.keys(moods as object)).toEqual([...LYRIC_MOODS]);
    });

    it('reads JSON wrapped in prose or a code fence', () => {
        expect(readMoods('Here you go:\n```json\n{"moods":{"anger":1}}\n```')).toMatchObject({ anger: 1 });
    });

    it('takes "could not tell" as an answer of its own', () => {
        expect(readMoods('{"unknown":true}')).toBe('unknown');
    });

    it.each([
        'no json at all',
        '{"moods":{"love":-1,"sadness":2}}',
        '{"moods":{"love":"lots"}}',
        '{"moods":{}}',
        '{"moods":{"love":0}}',
        '{"moods":',
    ])('reads %s as no answer', answer => {
        expect(readMoods(answer)).toBeUndefined();
    });
});

describe('moodsPrompt', () => {
    it('shows the lyric, bounded, and says it may search when it can', () => {
        const [, user] = moodsPrompt({ ...subject, lyric: 'x'.repeat(MAX_PROMPT_LYRIC_CHARS + 50) }, true);

        expect(user?.content).toContain('"Glory Box" by Portishead from Dummy (1994)');
        expect(user?.content).toContain('x'.repeat(MAX_PROMPT_LYRIC_CHARS));
        expect(user?.content).not.toContain('x'.repeat(MAX_PROMPT_LYRIC_CHARS + 1));
        expect(user?.content).toContain('search the web');
    });

    it('says when there is no lyric, and says nothing about searching when it cannot', () => {
        const [, user] = moodsPrompt(subject, false);

        expect(user?.content).toContain('not been given its lyric');
        expect(user?.content).not.toContain('search');
    });

    it('tells it an instrumental has no words to read', () => {
        const [, user] = moodsPrompt({ ...subject, instrumental: true }, true);
        expect(user?.content).toContain('instrumental');
        expect(user?.content).not.toContain('not been given its lyric');
    });

    it('never asks for words back', () => {
        const [system] = moodsPrompt(subject, true);
        expect(system?.content).toContain('Never quote the lyric');
    });

    it('carries a version that changes with the instructions', () => {
        expect(MOODS_VERSION).toMatch(/^m1-[0-9a-f]{12}$/);
    });
});

describe('mood stages', () => {
    it('keeps the known moods in order, at most four, and spells no lean as absent', () => {
        expect(moodStages(['comfort', 'sadness'])).toEqual(['comfort', 'sadness']);
        expect(moodStages(['comfort', 'joy', 'fear'])).toEqual(['comfort', 'fear']);
        expect(moodStages(['love', 'love', 'anger', 'fear', 'comfort'])).toHaveLength(MAX_MOOD_STAGES);
        expect(moodStages([])).toBeUndefined();
        expect(moodStages(null)).toBeUndefined();
        expect(moodStages(['joy'])).toBeUndefined();
    });

    it('spreads as a field, or as nothing at all', () => {
        expect(moodsField(['comfort'])).toEqual({ moods: ['comfort'] });
        expect(moodsField([])).toEqual({});
    });
});
