// How long the station lets itself talk, now that it is a row rather than a constant.
//
// Every case here is really about one asymmetry: raising a ceiling costs nothing, because a ceiling
// is not a target and the model stops where it stops, while LOWERING one past what a break needs
// hands every model break to the phrasings with nothing on any page saying why. So the floor is
// enforced and the values are read as the strings `AppConfig` actually holds.

import { describe, expect, it } from 'vitest';
import type { AppConfig } from '@maroonedsoftware/appconfig';

import {
    resolveBreakWords,
    resolveStoryWords,
    BREAK_WORD_KEYS,
    DEFAULT_STORY_WORDS,
    MAX_BREAK_WORDS,
    MAX_STORY_WORDS,
    MIN_BREAK_WORDS,
    MIN_STORY_WORDS,
} from '../../../src/modules/director/break.words.js';
import { DEFAULT_MAX_WORDS } from '../../../src/modules/director/break.prompt.js';

/**
 * A config that hands back STRINGS, which is the whole reason these resolvers exist.
 *
 * A double that coerces on the way out is worse than no double at all: every layer of `AppConfig`
 * holds text, and `get`'s overload widens its return from the default, so a test handing over a real
 * number passes whether or not the resolver parses anything.
 */
const configOf = (values: Record<string, string>): AppConfig =>
    ({ get: (key: string, fallback: unknown) => (key in values ? values[key] : fallback) }) as unknown as AppConfig;

describe('resolveBreakWords', () => {
    it('is the prompt’s own default when nothing is set', () => {
        expect(resolveBreakWords(configOf({}))).toBe(DEFAULT_MAX_WORDS);
    });

    it('reads a stored row, which arrives as text', () => {
        expect(resolveBreakWords(configOf({ [BREAK_WORD_KEYS.talk]: '90' }))).toBe(90);
    });

    // The failure this exists for. A break refused for running past three words falls to the
    // operator's phrasings every time, and the symptom is a station that stopped sounding like the
    // character somebody chose.
    it('clamps a figure too small to name a record and say one thing about it', () => {
        expect(resolveBreakWords(configOf({ [BREAK_WORD_KEYS.talk]: '3' }))).toBe(MIN_BREAK_WORDS);
    });

    it('clamps an absurd one rather than refusing to load', () => {
        expect(resolveBreakWords(configOf({ [BREAK_WORD_KEYS.talk]: '5000' }))).toBe(MAX_BREAK_WORDS);
    });

    it('takes the default for a value nobody can parse, which is a setting nobody set', () => {
        expect(resolveBreakWords(configOf({ [BREAK_WORD_KEYS.talk]: 'plenty' }))).toBe(DEFAULT_MAX_WORDS);
    });

    it('answers whole words', () => {
        expect(resolveBreakWords(configOf({ [BREAK_WORD_KEYS.talk]: '62.5' }))).toBe(63);
    });
});

describe('resolveStoryWords', () => {
    it('is its own default, because a story is not a link', () => {
        expect(resolveStoryWords(configOf({}))).toBe(DEFAULT_STORY_WORDS);
    });

    it('clamps to its own floor and ceiling', () => {
        expect(resolveStoryWords(configOf({ [BREAK_WORD_KEYS.story]: '5' }))).toBe(MIN_STORY_WORDS);
        expect(resolveStoryWords(configOf({ [BREAK_WORD_KEYS.story]: '9000' }))).toBe(MAX_STORY_WORDS);
    });

    // Two keys and not one, which is the point of the story kind existing at all: an operator who
    // wants short links and room for an anecdote can have both.
    it('is set independently of the talk break', () => {
        const config = configOf({ [BREAK_WORD_KEYS.talk]: '25', [BREAK_WORD_KEYS.story]: '200' });

        expect(resolveBreakWords(config)).toBe(25);
        expect(resolveStoryWords(config)).toBe(200);
    });
});
