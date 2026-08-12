// How bytes are laid out and every guard against a path that is not what it claims belong to
// ContentStore and are tested there, once. What is left here is what this store adds: which formats
// it holds, what each is served as, and which of the things a provider may call audio on the way in
// map onto them — the last one being where a station quietly ends up with a file named after a guess.

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
    TRACK_CONTENT_TYPES,
    TRACK_EXTENSIONS,
    TRACK_SOURCE_TYPES,
    TrackStore,
    isTrackExtension,
} from '../../../../src/modules/playout/audio/track.store.js';

let root: string;
let store: TrackStore;

beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'deadair-track-store-test-'));
    store = new TrackStore(root);
});

afterEach(async () => {
    await rm(root, { recursive: true, force: true });
});

describe('TrackStore', () => {
    it('holds every format the audio operation declares', async () => {
        const bytes = Buffer.from('four minutes of a record');

        for (const ext of TRACK_EXTENSIONS) {
            const checksum = await store.write(bytes, ext);
            expect(await store.read(checksum, ext)).toEqual(bytes);
            expect(store.contentTypeFor(ext)).toBe(TRACK_CONTENT_TYPES[ext]);
        }
    });

    it('serves mp3 as audio/mpeg, which is what Liquidsoap chooses its decoder from', () => {
        expect(store.contentTypeFor('mp3')).toBe('audio/mpeg');
    });

    it('does not hold audio it has no mime for', () => {
        expect(isTrackExtension('aiff')).toBe(false);
        expect(isTrackExtension('opus')).toBe(false);
        expect(() => store.pathFor('a'.repeat(64), 'aiff' as never)).toThrow(/extension/);
    });

    // Two bindings that resolve to identical audio are one file. That is what makes a re-fetch free
    // and what stops a track bound twice within one provider from costing twice the disk.
    it('files identical audio under one name however many times it arrives', async () => {
        const bytes = Buffer.from('the same master, fetched twice');

        expect(await store.write(bytes, 'ogg')).toBe(await store.write(bytes, 'ogg'));
    });

    // The generous half. Every value here is something a real server sends for audio it is serving,
    // and each has to land on a format the store can actually name.
    it('maps every content type it accepts onto a format it holds', () => {
        for (const [contentType, ext] of Object.entries(TRACK_SOURCE_TYPES)) {
            expect(isTrackExtension(ext), `${contentType} maps to ${ext}`).toBe(true);
        }
    });

    it('accepts the unregistered spellings a provider actually sends', () => {
        expect(TRACK_SOURCE_TYPES['audio/mp3']).toBe('mp3');
        expect(TRACK_SOURCE_TYPES['audio/x-flac']).toBe('flac');
        expect(TRACK_SOURCE_TYPES['application/ogg']).toBe('ogg');
    });

    // The cacher declines anything not in the map rather than naming a file after a guess: an HTML
    // error page served as audio is the case this catches.
    it('has no mapping for something that is not audio', () => {
        expect(TRACK_SOURCE_TYPES['text/html']).toBeUndefined();
        expect(TRACK_SOURCE_TYPES['application/json']).toBeUndefined();
    });
});
