// `normalizeKey` is the last rung of the ingest resolution ladder: when an mbid
// and an isrc have both failed, two rows are the same work if and only if these
// keys match. So the tests come in two halves — spellings that MUST collide,
// and distinctions that must NOT be flattened, because a key that over-matches
// silently binds one artist's tracks to another.
//
// The non-Latin cases carry the most weight. They are not a nicety: an artist
// whose name yields an empty key cannot be stored at all (`artist_key` is
// `not null unique`, so one shared row would swallow every such artist), so
// anything this function drops entirely is music the station cannot hold.

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

    it('drops punctuation', () => {
        expect(normalizeKey('Godspeed You! Black Emperor')).toBe('godspeed you black emperor');
    });

    describe('apostrophes', () => {
        it('deletes them rather than spacing them, so the elided spelling matches', () => {
            // Spacing gives "don t stop me now", which is neither spelling
            // anyone types — the whole point of folding it.
            expect(normalizeKey("Don't Stop Me Now")).toBe('dont stop me now');
            expect(normalizeKey('Dont Stop Me Now')).toBe('dont stop me now');
        });

        it.each([
            ['ASCII', "Don't"],
            ['typographic right single quote', 'Don’t'],
            ['left single quote', 'Don‘t'],
            ['modifier letter apostrophe', 'Donʼt'],
            ['okina', 'Donʻt'],
            ['grave accent', 'Don`t'],
            ['acute accent', 'Don´t'],
            ['prime', 'Don′t'],
        ])('treats the %s form the same as every other', (_label, spelling) => {
            // The last four are the interesting ones: `ʼ` and `ʻ` are Unicode
            // letters and survive the \p{L} filter, and `´` decomposes into a
            // space plus a combining acute that would strand mid-word.
            expect(normalizeKey(spelling)).toBe('dont');
        });

        it('folds the okina, which is a letter in Hawaiian but a keystroke people skip', () => {
            expect(normalizeKey('Hawaiʻi')).toBe('hawaii');
            expect(normalizeKey("Hawai'i")).toBe(normalizeKey('Hawaii'));
        });

        it('leaves the words either side joined only where the apostrophe was', () => {
            expect(normalizeKey("Rock 'n' Roll")).toBe('rock n roll');
            expect(normalizeKey("L'Arc~en~Ciel")).toBe('larc en ciel');
        });
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

    describe('scripts other than Latin', () => {
        it.each([
            ['Japanese', 'サカナクション'],
            ['Cyrillic', 'Мумий Тролль'],
            ['Hangul', '방탄소년단'],
            ['Han', '宇多田ヒカル'],
            ['Greek', 'Σίσυφος'],
            ['Hebrew', 'אריק איינשטיין'],
            ['Arabic', 'بدر'],
            ['Thai', 'ก้อน'],
        ])('keeps a %s name as a usable key rather than dropping it', (_script, name) => {
            expect(normalizeKey(name).length).toBeGreaterThan(0);
        });

        it('keeps the Latin part of a mixed name alongside the rest', () => {
            expect(normalizeKey('宇多田ヒカル Utada')).toBe('宇多田ヒカル utada');
            expect(normalizeKey('BTS 방탄소년단')).toBe('bts 방탄소년단');
        });

        it('does not conflate Japanese voiced kana with their unvoiced base', () => {
            // NFKD splits `が` into `か` + a combining voice mark. Stripping that
            // mark as though it were a Latin accent would merge distinct words.
            expect(normalizeKey('が')).not.toBe(normalizeKey('か'));
            expect(normalizeKey('だ')).not.toBe(normalizeKey('た'));
            expect(normalizeKey('ガガガSP')).not.toBe(normalizeKey('カカカSP'));
        });

        it('does not conflate Cyrillic й with и', () => {
            // `й` decomposes to `и` + U+0306, which sits in the very range the
            // Latin accent rule covers — hence that rule requiring a Latin base.
            expect(normalizeKey('й')).not.toBe(normalizeKey('и'));
            expect(normalizeKey('Мумий')).not.toBe(normalizeKey('Мумии'));
        });

        it('does not split a word where a mark could be mistaken for punctuation', () => {
            // The failure this replaced: `がっこうぐらし` came out as "か っこうく らし".
            expect(normalizeKey('がっこうぐらし')).toBe('がっこうぐらし');
            expect(normalizeKey('がっこうぐらし')).not.toContain(' ');
        });

        it.each([
            ['composed and decomposed Hangul', '한국', '한국'.normalize('NFD')],
            ['composed and decomposed kana', 'が', 'が'.normalize('NFD')],
            ['half-width and full-width katakana', 'ｶﾞｷ', 'ガキ'],
            ['full-width and ASCII latin', 'Ａｂｃ', 'Abc'],
        ])('folds %s together', (_label, a, b) => {
            expect(normalizeKey(a)).toBe(normalizeKey(b));
        });

        it('still tells two different non-Latin names apart', () => {
            expect(normalizeKey('サカナクション')).not.toBe(normalizeKey('サカナ'));
        });
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
