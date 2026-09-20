import { describe, expect, it } from 'vitest';

import { voiceMapOf, voiceRowsAreComplete } from '../src/rhapsode.voices.js';

/** Rows as the host stores a `list` field: a JSON array of objects, in a string. */
const rows = (...entries: Record<string, string>[]): string => JSON.stringify(entries);

describe('voiceMapOf', () => {
    it('reads a full row as all four of its parts', () => {
        const map = voiceMapOf(rows({ name: 'host', engine: 'chatterbox', voice: 'gravel', variant: 'turbo' }));

        expect(map).toEqual({ host: { engine: 'chatterbox', voice: 'gravel', variant: 'turbo' } });
    });

    it('leaves the engine absent when the row names none, rather than filling in a default', () => {
        // The default is applied at speak time on purpose: changing it at the top of the form has to
        // move every row that never named one.
        const map = voiceMapOf(rows({ name: 'host', voice: 'af_heart' }));

        expect(map.host).toEqual({ voice: 'af_heart' });
        expect(map.host).not.toHaveProperty('engine');
    });

    it('trims every cell, because a trailing space in a voice id is a 404', () => {
        const map = voiceMapOf(rows({ name: ' host ', engine: ' kokoro ', voice: ' af_heart ', variant: ' fp16 ' }));

        expect(map).toEqual({ host: { engine: 'kokoro', voice: 'af_heart', variant: 'fp16' } });
    });

    it('drops a row with no engine voice in it, because half a mapping is not a mapping', () => {
        const map = voiceMapOf(rows({ name: 'host', engine: 'kokoro' }, { name: 'newsreader', voice: 'bf_emma' }));

        expect(Object.keys(map)).toEqual(['newsreader']);
    });

    it('drops a row with no station name, which is a voice nothing can ask for', () => {
        expect(voiceMapOf(rows({ voice: 'af_heart' }))).toEqual({});
    });

    it('treats a blank cell as an absent one', () => {
        const map = voiceMapOf(rows({ name: 'host', engine: '  ', voice: 'af_heart', variant: '' }));

        expect(map.host).toEqual({ voice: 'af_heart' });
    });

    it('answers no mappings for anything unreadable, so init survives a hand-edited row', () => {
        // Every voice then falls back to the defaults, which is a station that sounds wrong rather
        // than one that is silent.
        expect(voiceMapOf(undefined)).toEqual({});
        expect(voiceMapOf('')).toEqual({});
        expect(voiceMapOf('not json')).toEqual({});
        expect(voiceMapOf('[]')).toEqual({});
        expect(voiceMapOf(42)).toEqual({});
    });

    it('lets a later row win, since the map is keyed by the station name', () => {
        const map = voiceMapOf(rows({ name: 'host', voice: 'first' }, { name: 'host', voice: 'second' }));

        expect(map.host).toEqual({ voice: 'second' });
    });
});

describe('voiceRowsAreComplete', () => {
    it('passes a row with both halves', () => {
        expect(voiceRowsAreComplete(rows({ name: 'host', voice: 'af_heart' }))).toBe(true);
    });

    it('passes an unset field, because a station that has never opened the form is not in error', () => {
        expect(voiceRowsAreComplete(undefined)).toBe(true);
    });

    it('refuses a row naming a station voice with nothing to say it in', () => {
        expect(voiceRowsAreComplete(rows({ name: 'host' }))).toBe(false);
        expect(voiceRowsAreComplete(rows({ name: 'host', engine: 'kokoro' }))).toBe(false);
        expect(voiceRowsAreComplete(rows({ name: 'host', variant: 'turbo' }))).toBe(false);
    });

    it('refuses an engine voice nothing points at', () => {
        expect(voiceRowsAreComplete(rows({ voice: 'af_heart' }))).toBe(false);
    });

    it('passes an entirely empty row, which is what the form leaves behind', () => {
        // Refusing the save over it would be the form fighting the operator.
        expect(voiceRowsAreComplete(rows({ name: '', engine: '', voice: '', variant: '' }))).toBe(true);
    });
});
