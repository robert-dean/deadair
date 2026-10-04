// What a plugin's answer becomes before it is stored. Three answers rather than two, because an
// instrumental is neither a miss nor words; and timed lines that are out of order, or end before
// they start, are a source's mistake that every reader downstream would otherwise believe.

import { describe, expect, it, vi } from 'vitest';

import { MAX_LYRIC_LINES, MAX_LYRIC_TEXT, sanitizeLyrics } from '../../../src/modules/lyrics/lyrics.sanitize.js';

describe('sanitizeLyrics', () => {
    it('reads an empty answer as a miss', () => {
        expect(sanitizeLyrics({})).toEqual({ kind: 'miss' });
        expect(sanitizeLyrics(undefined)).toEqual({ kind: 'miss' });
    });

    it('keeps plain words, timed lines, a language and the provider reference', () => {
        expect(
            sanitizeLyrics({
                plain: '  First line\nSecond line  ',
                synced: [{ atMs: 12_400, endMs: 15_000, text: 'First line' }],
                language: 'en',
                providerRef: '42',
            }),
        ).toEqual({
            kind: 'words',
            plain: 'First line\nSecond line',
            synced: [{ atMs: 12_400, endMs: 15_000, text: 'First line' }],
            language: 'en',
            providerRef: '42',
        });
    });

    it('lets an instrumental win over any words that came with it', () => {
        const warn = vi.fn();
        expect(sanitizeLyrics({ instrumental: true, plain: 'la la', providerRef: '7' }, warn)).toEqual({ kind: 'instrumental', providerRef: '7' });
        expect(warn).toHaveBeenCalledOnce();
    });

    it('sorts timed lines by their start', () => {
        const result = sanitizeLyrics({
            synced: [
                { atMs: 20_000, text: 'second' },
                { atMs: 10_000, text: 'first' },
            ],
        });
        expect(result.kind === 'words' && result.synced?.map(line => line.text)).toEqual(['first', 'second']);
    });

    it('drops an end that comes before its start, rather than keeping a range nobody sang', () => {
        const result = sanitizeLyrics({ synced: [{ atMs: 10_000, endMs: 9_000, text: 'line' }] });
        expect(result.kind === 'words' && result.synced).toEqual([{ atMs: 10_000, text: 'line' }]);
    });

    it('drops unusable lines and says so', () => {
        const warn = vi.fn();
        const result = sanitizeLyrics(
            {
                synced: [
                    { atMs: -1, text: 'bad' },
                    { atMs: Number.NaN, text: 'bad' },
                    { atMs: 5, text: 'good' },
                ],
            },
            warn,
        );
        expect(result.kind === 'words' && result.synced).toEqual([{ atMs: 5, text: 'good' }]);
        expect(warn).toHaveBeenCalledWith('2 timed lines were unusable and dropped');
    });

    it('keeps a blank timed line, which in LRC marks where the line before it stops being sung', () => {
        const result = sanitizeLyrics({
            synced: [
                { atMs: 1_000, text: 'sung' },
                { atMs: 4_000, text: '' },
            ],
        });
        expect(result.kind === 'words' && result.synced).toHaveLength(2);
    });

    it('reads timings with no words at all as a miss', () => {
        expect(sanitizeLyrics({ synced: [{ atMs: 1_000, text: '' }] })).toEqual({ kind: 'miss' });
    });

    it('drops a language tag that is not one, rather than storing a guess', () => {
        const result = sanitizeLyrics({ plain: 'words', language: 'English (probably)' });
        expect(result).toEqual({ kind: 'words', plain: 'words' });
    });

    it('caps the plain text and the number of lines', () => {
        const result = sanitizeLyrics({
            plain: 'x'.repeat(MAX_LYRIC_TEXT + 10),
            synced: Array.from({ length: MAX_LYRIC_LINES + 5 }, (_, index) => ({ atMs: index, text: 'line' })),
        });
        expect(result.kind === 'words' && result.plain?.length).toBe(MAX_LYRIC_TEXT);
        expect(result.kind === 'words' && result.synced?.length).toBe(MAX_LYRIC_LINES);
    });
});
