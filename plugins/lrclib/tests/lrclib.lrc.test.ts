// LRC as timed lines. The cases are the ones LRCLIB's own bodies carry: a blank timed line marking
// where singing stops, a fraction written to two digits or three, a chorus stamped twice on one line,
// an offset tag, and per-word timings, which become a line's words rather than lines of their own.

import { describe, expect, it } from 'vitest';

import { isInstrumentalBody, parseLrc } from '../src/lrclib.lrc.js';

describe('parseLrc', () => {
    it('reads timestamps to the millisecond, however many digits the fraction has', () => {
        expect(parseLrc('[00:29.79] I’m so tired of playing\n[01:02.5] Half\n[02:00.123] Three\n[03:04] None')).toEqual([
            { atMs: 29_790, text: 'I’m so tired of playing' },
            { atMs: 62_500, text: 'Half' },
            { atMs: 120_123, text: 'Three' },
            { atMs: 184_000, text: 'None' },
        ]);
    });

    it('keeps a blank timed line, which marks where the line before it stops being sung', () => {
        expect(parseLrc('[00:54.89] Give me a reason\n[01:00.37] ')).toEqual([
            { atMs: 54_890, text: 'Give me a reason' },
            { atMs: 60_370, text: '' },
        ]);
    });

    it('writes a line stamped twice as two lines, in time order', () => {
        expect(parseLrc('[00:10.00][01:30.00] Chorus\n[00:20.00] Verse')).toEqual([
            { atMs: 10_000, text: 'Chorus' },
            { atMs: 20_000, text: 'Verse' },
            { atMs: 90_000, text: 'Chorus' },
        ]);
    });

    it('applies an offset, positive meaning sooner, and never below zero', () => {
        expect(parseLrc('[offset:+500]\n[00:00.20] First\n[00:10.00] Second')).toEqual([
            { atMs: 0, text: 'First' },
            { atMs: 9_500, text: 'Second' },
        ]);
    });

    it('skips metadata tags and keeps per-word timings as words, out of the text', () => {
        expect(parseLrc('[ar: Portishead]\n[ti: Glory Box]\n[00:05.00] <00:05.00>Word <00:05.50>by <00:06.00>word')).toEqual([
            {
                atMs: 5_000,
                text: 'Word by word',
                words: [
                    { atMs: 5_000, text: 'Word ' },
                    { atMs: 5_500, text: 'by ' },
                    { atMs: 6_000, text: 'word' },
                ],
            },
        ]);
    });

    it('cuts a line into pieces that join back to its text exactly, syllables included', () => {
        const [line] = parseLrc('[00:10.00] So <00:10.40>beau<00:10.70>ti<00:10.90>ful <00:11.50>');
        expect(line!.words).toEqual([
            { atMs: 10_000, text: 'So ' },
            { atMs: 10_400, text: 'beau' },
            { atMs: 10_700, text: 'ti' },
            { atMs: 10_900, text: 'ful' },
        ]);
        expect(line!.words!.map(word => word.text).join('')).toBe(line!.text);
    });

    it('folds whitespace after an end marker into the word before it', () => {
        const [line] = parseLrc('[00:01.00]<00:01.00>one<00:01.40> <00:01.50>two');
        expect(line).toEqual({
            atMs: 1_000,
            text: 'one two',
            words: [
                { atMs: 1_000, text: 'one ' },
                { atMs: 1_500, text: 'two' },
            ],
        });
    });

    it('applies the offset to the words too', () => {
        expect(parseLrc('[offset:+500]\n[00:10.00]<00:10.00>Hello <00:10.80>there')[0]!.words).toEqual([
            { atMs: 9_500, text: 'Hello ' },
            { atMs: 10_300, text: 'there' },
        ]);
    });

    it('moves the words of a line stamped twice along with each stamp', () => {
        const lines = parseLrc('[00:10.00][01:30.00]<00:10.00>La <00:10.50>la');
        expect(lines.map(line => line.words!.map(word => word.atMs))).toEqual([
            [10_000, 10_500],
            [90_000, 90_500],
        ]);
    });

    it('leaves words unset on a line with no word tags', () => {
        expect(parseLrc('[00:01.00] One')[0]).not.toHaveProperty('words');
    });

    it('reads Windows line endings', () => {
        expect(parseLrc('[00:01.00] One\r\n[00:02.00] Two')).toHaveLength(2);
    });

    it('never sets an end, which LRC does not carry', () => {
        expect(parseLrc('[00:01.00] One').every(line => line.endMs === undefined)).toBe(true);
    });
});

describe('isInstrumentalBody', () => {
    it('recognises the markers LRCLIB bodies carry', () => {
        expect(isInstrumentalBody(['[au: instrumental]'])).toBe(true);
        expect(isInstrumentalBody(['Instrumental'])).toBe(true);
        expect(isInstrumentalBody(['(Instrumental)', ''])).toBe(true);
    });

    it('does not mistake a song that sings the word for one with no words', () => {
        expect(isInstrumentalBody(['This is an instrumental', 'of my love'])).toBe(false);
        expect(isInstrumentalBody(['Instrumental', 'and then the words'])).toBe(false);
    });

    it('does not call an empty body instrumental', () => {
        expect(isInstrumentalBody(['', '  '])).toBe(false);
    });
});
