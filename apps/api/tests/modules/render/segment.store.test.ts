// How bytes are laid out and every guard against a path that is not what it claims belong to
// ContentStore and are tested there, once. What is left here is what this store adds: which formats
// it holds, and what each is served as — which is the load-bearing half, because both consumers of
// segment audio pick their behaviour from the Content-Type rather than from the bytes.

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
    SEGMENT_CONTENT_TYPES,
    SEGMENT_EXTENSIONS,
    SegmentStore,
    isSegmentExtension,
    subdirectoryIsSafe,
} from '../../../src/modules/render/segment.store.js';

let root: string;
let store: SegmentStore;

beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'deadair-segment-store-test-'));
    store = new SegmentStore(root);
});

afterEach(async () => {
    await rm(root, { recursive: true, force: true });
});

describe('SegmentStore', () => {
    // One is not more real than another: a wav is written, read and served as a wav. The store held
    // mp3 alone until the contract could declare a mime per format.
    it('holds every format the audio operation declares', async () => {
        const bytes = Buffer.from('a station ident');

        for (const ext of SEGMENT_EXTENSIONS) {
            const checksum = await store.write(bytes, ext);
            expect(await store.read(checksum, ext)).toEqual(bytes);
            expect(store.contentTypeFor(ext)).toBe(SEGMENT_CONTENT_TYPES[ext]);
        }
    });

    it('serves mp3 as audio/mpeg, which is what Liquidsoap chooses its decoder from', () => {
        expect(store.contentTypeFor('mp3')).toBe('audio/mpeg');
    });

    it('does not hold audio it has no mime for', () => {
        expect(isSegmentExtension('aiff')).toBe(false);
        expect(isSegmentExtension('sh')).toBe(false);
        expect(() => store.pathFor('a'.repeat(64), 'aiff' as never)).toThrow(/extension/);
    });

    // The free function and the method are the same question asked from two places: the library
    // scan has only a filename, while a caller holding the store has the store.
    it('agrees with its own free function about what it holds', () => {
        for (const ext of SEGMENT_EXTENSIONS) {
            expect(isSegmentExtension(ext)).toBe(true);
            expect(store.isExtension(ext)).toBe(true);
        }
    });
});

// The guard both audio libraries share: a subdirectory an upload names reaches `join(root, name)`,
// so what is under test is that nothing can escape the root, and that an ordinary directory name an
// operator made by hand is still allowed through.
describe('subdirectoryIsSafe', () => {
    it('takes a directory an operator could plausibly have made by hand', () => {
        expect(subdirectoryIsSafe('wisecrack')).toBe(true);
        expect(subdirectoryIsSafe('My Board')).toBe(true);
    });

    it('refuses anything that could write outside the library', () => {
        expect(subdirectoryIsSafe('../etc')).toBe(false);
        expect(subdirectoryIsSafe('a/b')).toBe(false);
        expect(subdirectoryIsSafe('a\\b')).toBe(false);
        expect(subdirectoryIsSafe('.hidden')).toBe(false);
        expect(subdirectoryIsSafe('   ')).toBe(false);
    });
});
