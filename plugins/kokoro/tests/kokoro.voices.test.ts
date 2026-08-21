// The map from the station's own voice names to what they are on this server. It used to be a
// one-line box of `host = af_heart` entries with a hand-written parser; it is a `list` field now,
// stored as JSON rows, so most of what this file used to test is the host's problem and the rest is
// about what a half-filled row means.

import { describe, expect, it } from 'vitest';

import { MAX_SPEED, MIN_SPEED, speedOf, voiceMapOf, voiceRowsAreComplete } from '../src/kokoro.voices.js';

/** Rows as the host stores them: a JSON array of objects, in a string. */
const rows = (...entries: Record<string, string>[]): string => JSON.stringify(entries);

describe('voiceMapOf', () => {
    it('reads a row per station voice', () => {
        expect(voiceMapOf(rows({ name: 'host', engine: 'af_heart' }, { name: 'newsreader', engine: 'am_michael' }))).toEqual({
            host: { engine: 'af_heart' },
            newsreader: { engine: 'am_michael' },
        });
    });

    it('keeps a speed when one was set, and sends nothing when one was not', () => {
        // Absent is not the same as 1: a request with no `speed` is the plainest thing the plugin
        // can ask for, and it is what every voice asked for before the column existed.
        expect(voiceMapOf(rows({ name: 'host', engine: 'af_heart', speed: '0.9' }))).toEqual({ host: { engine: 'af_heart', speed: 0.9 } });
        expect(voiceMapOf(rows({ name: 'host', engine: 'af_heart' }))).toEqual({ host: { engine: 'af_heart' } });
    });

    it('takes a blend expression as an engine voice, because the engine does', () => {
        // Which is why the column is free text with suggestions rather than a closed select: a blend
        // names no single voicepack and would never appear in the server's own list.
        expect(voiceMapOf(rows({ name: 'host', engine: 'af_bella(2)+af_sky(1)' }))).toEqual({ host: { engine: 'af_bella(2)+af_sky(1)' } });
    });

    it('drops a row missing either half rather than half-keeping it', () => {
        // The form leaves an empty row behind whenever an operator adds one and thinks better of it,
        // and half a mapping is not a mapping.
        expect(voiceMapOf(rows({ name: 'host' }, { engine: 'af_heart' }, { name: 'newsreader', engine: 'am_michael' }))).toEqual({
            newsreader: { engine: 'am_michael' },
        });
    });

    it('reads a malformed value as empty, because init must not be what refuses it', () => {
        // `configSchema` already judged anything an operator saved. A station with no mappings falls
        // back to the default voice, which is a station that sounds wrong rather than a silent one —
        // and failing to load here would be the second.
        expect(voiceMapOf('nonsense')).toEqual({});
        expect(voiceMapOf(undefined)).toEqual({});
        expect(voiceMapOf(42)).toEqual({});
        expect(voiceMapOf('{"host":"af_heart"}')).toEqual({});
    });
});

describe('speedOf', () => {
    it('reads the number out of the cell, since every cell is a string', () => {
        expect(speedOf('1.25')).toBe(1.25);
    });

    it('is absent for a cell nobody filled in', () => {
        expect(speedOf(undefined)).toBeUndefined();
        expect(speedOf('')).toBeUndefined();
        expect(speedOf('   ')).toBeUndefined();
    });

    it('is absent for something that is not a number, rather than guessing', () => {
        expect(speedOf('fast')).toBeUndefined();
        expect(speedOf('0')).toBeUndefined();
        expect(speedOf('-1')).toBeUndefined();
    });

    it('clamps out of range rather than refusing', () => {
        // An operator asking for something the engine cannot do is asking for the nearest thing it
        // can, which is a better answer than ignoring them. The form's own note is where the range
        // is stated.
        expect(speedOf('99')).toBe(MAX_SPEED);
        expect(speedOf('0.01')).toBe(MIN_SPEED);
    });
});

describe('voiceRowsAreComplete', () => {
    it('accepts rows that name both halves', () => {
        expect(voiceRowsAreComplete(rows({ name: 'host', engine: 'af_heart' }))).toBe(true);
        expect(voiceRowsAreComplete(undefined)).toBe(true);
        expect(voiceRowsAreComplete('')).toBe(true);
    });

    it('refuses a row with only one half, while the operator is still looking at the table', () => {
        // A typo that silently maps nothing shows up much later as a voice that is somehow always
        // the default, which is the failure the whole field shape exists to prevent.
        expect(voiceRowsAreComplete(rows({ name: 'host' }))).toBe(false);
        expect(voiceRowsAreComplete(rows({ engine: 'af_heart' }))).toBe(false);
        expect(voiceRowsAreComplete(rows({ name: 'host', engine: 'af_heart' }, { name: 'newsreader' }))).toBe(false);
    });

    it('lets an abandoned empty row through', () => {
        // `parseRows` drops a row whose every cell is blank, so this is the form leaving one behind
        // rather than the operator asking for something impossible. Refusing the save over it would
        // be the form fighting them.
        expect(voiceRowsAreComplete(rows({ name: '', engine: '' }))).toBe(true);
        expect(voiceRowsAreComplete('[]')).toBe(true);
    });
});
