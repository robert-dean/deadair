import { describe, expect, it } from 'vitest';

import { firstJsonObject } from '../../../src/modules/shared/json.objects.js';

describe('firstJsonObject', () => {
    it('reads a bare object', () => {
        expect(firstJsonObject('{"about": "leaving home"}')).toEqual({ about: 'leaving home' });
    });

    it('reads one behind a sentence and inside a code fence', () => {
        expect(firstJsonObject('Here is the answer:\n```json\n{"unknown": true}\n```\nHope that helps.')).toEqual({ unknown: true });
    });

    it('reads past the thinking, even when the thinking has braces in it', () => {
        expect(firstJsonObject('<think>maybe {"about": "x"}? no.</think>\n{"about": "the sea"}')).toEqual({ about: 'the sea' });
    });

    it('keeps nested objects whole', () => {
        expect(firstJsonObject('{"moods": {"joy": 0.5, "grief": 0.5}}')).toEqual({ moods: { joy: 0.5, grief: 0.5 } });
    });

    it('takes the first of two objects rather than failing over the pair', () => {
        expect(firstJsonObject('{"facts": []} and also {"facts": [1]}')).toEqual({ facts: [] });
    });

    it('skips a malformed object for a well-formed one after it', () => {
        expect(firstJsonObject('{"about": oops} {"about": "home"}')).toEqual({ about: 'home' });
    });

    it('repairs a string a model wrapped across lines', () => {
        expect(firstJsonObject('{"about": "a long\n    sentence"}')).toEqual({ about: 'a long sentence' });
    });

    it('never reads an object the model did not finish', () => {
        expect(firstJsonObject('{"facts": [{"claim": "a"}, {"claim": "b"')).toBeUndefined();
    });

    it('answers undefined for prose and for an array', () => {
        expect(firstJsonObject('I cannot tell.')).toBeUndefined();
        expect(firstJsonObject('[1, 2, 3]')).toBeUndefined();
    });
});
