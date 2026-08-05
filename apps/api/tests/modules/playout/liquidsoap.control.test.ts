// `parseReading` is the whole compatibility boundary between the app and the stream
// script. The app and the container deploy independently, so a running Liquidsoap may
// be on an older radio.liq that reports less — and every field this gets wrong is a
// confident lie about what the listener is hearing.

import { describe, expect, it } from 'vitest';

import { parseReading } from '../../../src/modules/playout/liquidsoap.control.js';
import { annotateUri, ITEM_KEY } from '../../../src/modules/playout/annotate.js';

describe('parseReading', () => {
    it('reads a full reading', () => {
        expect(parseReading({ queued: 1, ready: true, onAir: 'item-1', remainingMs: 92_500 })).toEqual({
            queued: 1,
            ready: true,
            onAir: 'item-1',
            remainingMs: 92_500,
        });
    });

    it('rejects a body with no queue depth at all', () => {
        // This is how a 401 page, or some unrelated service answering on the port,
        // is told apart from a reading. Everything downstream treats `undefined` as
        // "the stream is not up", which is the safe reading of both.
        expect(parseReading({ error: 'denied' })).toBeUndefined();
        expect(parseReading('denied')).toBeUndefined();
        expect(parseReading(undefined)).toBeUndefined();
    });

    it('keeps only the fields an older script omits, rather than inventing them', () => {
        // Absent must mean "not reported", never "zero": the rundown keys its whole
        // believe-nothing path off `ready` being missing.
        expect(parseReading({ queued: 0 })).toEqual({ queued: 0 });
    });

    it('treats an empty onAir as nothing playing, not as an id', () => {
        // radio.liq reports "" when the queue is not producing.
        expect(parseReading({ queued: 0, ready: false, onAir: '' }).onAir).toBeUndefined();
    });

    it('drops a non-positive remaining time', () => {
        // radio.liq sends -1 for "cannot say", but `remaining()` itself answers 0 for
        // a queue with nothing on air — so a 0 reaching here is not a measurement of
        // an item at all.
        expect(parseReading({ queued: 0, ready: true, onAir: 'x', remainingMs: -1 }).remainingMs).toBeUndefined();
        expect(parseReading({ queued: 0, ready: true, onAir: 'x', remainingMs: 0 }).remainingMs).toBeUndefined();
    });

    it('ignores a malformed field instead of failing the whole reading', () => {
        const reading = parseReading({ queued: 2, ready: 'yes', onAir: 42, remainingMs: 'soon' });

        expect(reading).toEqual({ queued: 2 });
    });
});

describe('annotateUri', () => {
    it('wraps a uri so the item id survives the round trip through Liquidsoap', () => {
        expect(annotateUri({ [ITEM_KEY]: 'item-1' }, 'https://example.test/a.ogg')).toBe('annotate:deadair_item="item-1":https://example.test/a.ogg');
    });

    it('leaves a signed URL untouched: its own colons and query string must survive', () => {
        // The value is quoted, so the uri after the final colon is passed through whole.
        // A shim URL carries `?t=<signature>`, and mangling it fails on air.
        const uri = 'http://127.0.0.1:3679/track/abc?t=1234.sig-with-colons:in-it';

        expect(annotateUri({ [ITEM_KEY]: 'item-1' }, uri)).toBe(`annotate:deadair_item="item-1":${uri}`);
    });

    it('escapes quotes and backslashes in a value', () => {
        expect(annotateUri({ [ITEM_KEY]: 'a"b\\c' }, 'file:///x.mp3')).toBe('annotate:deadair_item="a\\"b\\\\c":file:///x.mp3');
    });

    it('returns the bare uri when there is nothing to annotate', () => {
        expect(annotateUri({}, 'file:///x.mp3')).toBe('file:///x.mp3');
    });
});
