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
    sniffSegmentExtension,
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

// What a file IS, from its first bytes. A publisher's media type is whatever their CMS wrote, and the
// extension decides what Liquidsoap is told the file is, so this reads the bytes instead.
describe('sniffSegmentExtension', () => {
    const bytes = (...values: number[]): Uint8Array => new Uint8Array(values);
    const text = (value: string, pad = 12): Uint8Array => {
        const out = new Uint8Array(Math.max(pad, value.length));
        for (let at = 0; at < value.length; at += 1) out[at] = value.charCodeAt(at);
        return out;
    };

    it.each([
        ['an MP3 behind an ID3 tag', text('ID3\u0004\u0000'), 'mp3'],
        ['a bare MPEG-1 layer III frame', bytes(0xff, 0xfb, 0x90, 0x64, 0, 0, 0, 0, 0, 0, 0, 0), 'mp3'],
        ['a bare MPEG-2 layer III frame', bytes(0xff, 0xf3, 0x90, 0x64, 0, 0, 0, 0, 0, 0, 0, 0), 'mp3'],
        ['an M4A', text('\u0000\u0000\u0000\u0020ftypM4A '), 'm4a'],
        ['an Ogg stream', text('OggS'), 'ogg'],
        ['a FLAC file', text('fLaC'), 'flac'],
        ['a WAV file', text('RIFF\u0000\u0000\u0000\u0000WAVE'), 'wav'],
    ] as const)('files %s as %s', (_label, head, expected) => {
        expect(sniffSegmentExtension(head)).toBe(expected);
    });

    // ADTS begins with the same sync word as an MP3 frame. Filed as either, it airs as silence.
    it('refuses raw AAC, which begins like an MP3 frame and is neither that nor an M4A', () => {
        expect(sniffSegmentExtension(bytes(0xff, 0xf1, 0x50, 0x80, 0, 0, 0, 0, 0, 0, 0, 0))).toBeUndefined();
        expect(sniffSegmentExtension(bytes(0xff, 0xf9, 0x50, 0x80, 0, 0, 0, 0, 0, 0, 0, 0))).toBeUndefined();
    });

    it('refuses what is not audio at all, like an error page served with a 200', () => {
        expect(sniffSegmentExtension(text('<!DOCTYPE html>'))).toBeUndefined();
        expect(sniffSegmentExtension(new Uint8Array(0))).toBeUndefined();
    });
});
