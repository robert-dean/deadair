import { describe, expect, it } from 'vitest';

import { personaKeyFor } from '../../../src/components/personas/persona.key';

describe('personaKeyFor', () => {
    it('lowercases and hyphenates a plain name', () => {
        expect(personaKeyFor('Late Night Companion')).toBe('late-night-companion');
    });

    it('leaves no hyphen at either end', () => {
        // The case that put this in its own module: a bracketed qualifier is an ordinary way to name
        // a weekend shift, and the naive replace leaves the key ending in a hyphen.
        expect(personaKeyFor('Night Porter (Weekends)')).toBe('night-porter-weekends');
        expect(personaKeyFor('  Dawn Chorus  ')).toBe('dawn-chorus');
        expect(personaKeyFor('...Breakfast...')).toBe('breakfast');
    });

    it('collapses a run of punctuation into one hyphen', () => {
        expect(personaKeyFor("The 6 O'Clock — News Desk")).toBe('the-6-o-clock-news-desk');
    });

    it('keeps digits, which are part of a real name', () => {
        expect(personaKeyFor('Studio 54')).toBe('studio-54');
    });

    it('answers the empty string when a name has nothing to slug', () => {
        // Not a fault: the editor treats this as a suggestion it could not make, and its own
        // validation refuses an empty key at save.
        expect(personaKeyFor('')).toBe('');
        expect(personaKeyFor('!!!')).toBe('');
        expect(personaKeyFor('深夜')).toBe('');
    });

    it('is idempotent, so a derived key survives being derived again', () => {
        const once = personaKeyFor('Night Porter (Weekends)');
        expect(personaKeyFor(once)).toBe(once);
    });
});
