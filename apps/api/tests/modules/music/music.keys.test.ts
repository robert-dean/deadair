// `normalizeKey` is the last rung of the ingest resolution ladder: when an mbid
// and an isrc have both failed, two rows are the same work if and only if these
// keys match. So the tests come in two halves — spellings that MUST collide,
// and distinctions that must NOT be flattened, because a key that over-matches
// silently binds one artist's tracks to another.

import { describe, expect, it } from 'vitest';

import { normalizeKey } from '../../../src/modules/music/music.keys.js';

describe('normalizeKey', () => {
    it('folds accents onto their base letters', () => {
        expect(normalizeKey('Beyoncé')).toBe(normalizeKey('Beyonce'));
        expect(normalizeKey('Sigur Rós')).toBe('sigur ros');
        expect(normalizeKey('Mötley Crüe')).toBe('motley crue');
    });

    it('folds precomposed and decomposed spellings of the same name together', () => {
        // Providers disagree about which Unicode form they emit, and the two are
        // indistinguishable on screen — the exact case a byte comparison misses.
        expect(normalizeKey('Björk')).toBe(normalizeKey('Björk'));
    });

    it('transliterates letters that have no decomposition, instead of dropping them', () => {
        // These are letters, not accented forms, so NFKD leaves them alone and
        // the non-alphanumeric pass would delete them — splitting the word and
        // stranding the title from every other spelling of it.
        expect(normalizeKey('Sæglópur')).toBe('saeglopur');
        expect(normalizeKey('Sæglópur')).toBe(normalizeKey('Saeglopur'));
        expect(normalizeKey('Blø')).toBe('blo');
        expect(normalizeKey('Straße')).toBe('strasse');
        expect(normalizeKey('Þeyr')).toBe('theyr');
    });

    it('ignores case', () => {
        expect(normalizeKey('THE NATIONAL')).toBe(normalizeKey('the national'));
    });

    it('drops punctuation, including the typographic apostrophes providers mix with ASCII', () => {
        expect(normalizeKey("Don't Stop Me Now")).toBe(normalizeKey('Don’t Stop Me Now'));
        expect(normalizeKey('Godspeed You! Black Emperor')).toBe('godspeed you black emperor');
    });

    it('collapses the whitespace punctuation removal leaves behind', () => {
        // "AC/DC" would otherwise normalize to "ac dc" while "AC DC" gives the
        // same thing only by accident; both must land on one key, with no
        // double space in between.
        expect(normalizeKey('AC/DC')).toBe('ac dc');
        expect(normalizeKey('  Sunday   Morning  ')).toBe('sunday morning');
        expect(normalizeKey('Weezer  -  Buddy Holly')).toBe('weezer buddy holly');
    });

    it('keeps digits, which carry meaning in titles', () => {
        expect(normalizeKey('Blink-182')).toBe('blink 182');
        expect(normalizeKey('1999')).toBe('1999');
    });

    it('returns an empty string when nothing survives normalization', () => {
        // `artist_key` is `not null unique`, so a caller has to notice this
        // rather than write every unnameable artist into one row.
        expect(normalizeKey('')).toBe('');
        expect(normalizeKey('   ')).toBe('');
        expect(normalizeKey('!!!')).toBe('');
    });

    it('does not flatten distinctions it has no business judging', () => {
        // Both are plausible duplicates. Deciding they are the same work is what
        // `merged_into_id` is for; a key match has to be trustworthy on its own.
        expect(normalizeKey('The Beatles')).not.toBe(normalizeKey('Beatles'));
        expect(normalizeKey('Nightswimming')).not.toBe(normalizeKey('Nightswimming - Remastered'));
    });

    it('is idempotent, so a stored key re-normalizes to itself', () => {
        const once = normalizeKey('Sigur Rós — Hoppípolla');
        expect(normalizeKey(once)).toBe(once);
    });
});
