// LRC as timed lines. The cases are the ones LRCLIB's own bodies carry: a blank timed line marking
// where singing stops, a fraction written to two digits or three, a chorus stamped twice on one line,
// an offset tag, and per-word timings that are not lines at all.

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

    it('skips metadata tags and drops per-word timings', () => {
        expect(parseLrc('[ar: Portishead]\n[ti: Glory Box]\n[00:05.00] <00:05.00>Word <00:05.50>by <00:06.00>word')).toEqual([
            { atMs: 5_000, text: 'Word by word' },
        ]);
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
