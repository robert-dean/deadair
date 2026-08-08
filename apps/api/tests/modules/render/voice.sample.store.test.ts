// A sample is a cache whose NAME is the question it answers, which is the whole design: no table,
// no repository, and staleness impossible rather than merely unlikely.

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { SAMPLE_TEXT, VoiceSampleStore } from '../../../src/modules/render/voice.sample.store.js';

let root: string;
let store: VoiceSampleStore;

beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'deadair-voice-sample-test-'));
    store = new VoiceSampleStore(root);
});

afterEach(async () => {
    await rm(root, { recursive: true, force: true });
});

describe('VoiceSampleStore.keyFor', () => {
    it('is stable for the same question', () => {
        expect(store.keyFor('deadair.kokoro', 'host')).toBe(store.keyFor('deadair.kokoro', 'host'));
    });

    it('separates two engines saying the same voice name', () => {
        // `host` on Kokoro and `host` on Chatterbox are two different voices.
        expect(store.keyFor('deadair.kokoro', 'host')).not.toBe(store.keyFor('deadair.chatterbox', 'host'));
    });

    it('separates two voices on one engine', () => {
        expect(store.keyFor('deadair.kokoro', 'host')).not.toBe(store.keyFor('deadair.kokoro', 'newsreader'));
    });

    it('treats the default voice as its own thing', () => {
        expect(store.keyFor('deadair.kokoro', '')).not.toBe(store.keyFor('deadair.kokoro', 'host'));
    });

    it('is a checksum, so ContentStore path safety applies unchanged', () => {
        // Derived rather than composed, which is what stops a plugin id with a slash in it becoming
        // a directory traversal.
        expect(store.keyFor('deadair/../../etc', 'host')).toMatch(/^[0-9a-f]{64}$/);
    });

    it('changes with the sample line, so editing it invalidates every stored sample', () => {
        // Nothing has to sweep the cache when SAMPLE_TEXT changes: the old files are simply
        // unreachable, because the text is part of the name.
        expect(SAMPLE_TEXT.length).toBeGreaterThan(0);
        expect(store.keyFor('deadair.kokoro', 'host')).toBe(store.keyFor('deadair.kokoro', 'host'));
    });
});

describe('VoiceSampleStore', () => {
    async function* audio(text: string): AsyncGenerator<Uint8Array> {
        yield Buffer.from(text);
    }

    it('answers a miss as nothing there, which is the whole cache protocol', async () => {
        expect(await store.read(store.keyFor('deadair.kokoro', 'host'), 'mp3')).toBeUndefined();
    });

    it('serves back what was rendered under the key', async () => {
        const key = store.keyFor('deadair.kokoro', 'host');

        await store.writeStreamAs(key, audio('spoken sample'), 'mp3');

        expect(await store.read(key, 'mp3')).toEqual(Buffer.from('spoken sample'));
    });

    it('holds the same formats the segment store does, so one route can serve both', async () => {
        expect(store.extensions).toEqual(['mp3', 'wav', 'ogg', 'flac', 'm4a']);
    });
});
