// The map from the station's own voice names to the reference clips this server reads from. The
// shape is the other speech plugin's and the reasoning for keeping it a separate copy is in the
// module's own comment; what is pinned here is the behaviour, since this is shipping code either way.

import { describe, expect, it } from 'vitest';

import { MAX_SPEED, MIN_SPEED, speedOf, voiceMapOf, voiceRowsAreComplete } from '../src/chatterbox.voices.js';

const rows = (...entries: Record<string, string>[]): string => JSON.stringify(entries);

describe('voiceMapOf', () => {
    it('reads a row per station voice, with the clip as the engine name', () => {
        expect(voiceMapOf(rows({ name: 'host', engine: 'Olivia.wav' }, { name: 'newsreader', engine: 'Michael.wav', speed: '0.9' }))).toEqual({
            host: { engine: 'Olivia.wav' },
            newsreader: { engine: 'Michael.wav', speed: 0.9 },
        });
    });

    it('drops a row missing either half rather than half-keeping it', () => {
        expect(voiceMapOf(rows({ name: 'host' }, { engine: 'Olivia.wav' }))).toEqual({});
    });

    it('reads a malformed value as empty, because init must not be what refuses it', () => {
        // A station with no mappings falls back to the default clip, which is a station that sounds
        // wrong rather than one that will not load.
        expect(voiceMapOf('nonsense')).toEqual({});
        expect(voiceMapOf(undefined)).toEqual({});
        expect(voiceMapOf(42)).toEqual({});
    });
});

describe('speedOf', () => {
    it('reads the number out of the cell, since every cell is a string', () => {
        expect(speedOf('1.25')).toBe(1.25);
    });

    it('is absent for a cell nobody filled in, or one that is not a number', () => {
        expect(speedOf(undefined)).toBeUndefined();
        expect(speedOf('  ')).toBeUndefined();
        expect(speedOf('quickly')).toBeUndefined();
        expect(speedOf('0')).toBeUndefined();
    });

    it('clamps out of range rather than refusing', () => {
        expect(speedOf('99')).toBe(MAX_SPEED);
        expect(speedOf('0.01')).toBe(MIN_SPEED);
    });
});

describe('voiceRowsAreComplete', () => {
    it('refuses a row with only one half, while the operator is still looking at the table', () => {
        expect(voiceRowsAreComplete(rows({ name: 'host', engine: 'Olivia.wav' }))).toBe(true);
        expect(voiceRowsAreComplete(rows({ name: 'host' }))).toBe(false);
        expect(voiceRowsAreComplete(undefined)).toBe(true);
    });

    it('lets an abandoned empty row through, rather than fighting the form', () => {
        expect(voiceRowsAreComplete(rows({ name: '', engine: '' }))).toBe(true);
    });
});
