// How bytes are laid out and every guard against a path that is not what it claims belong to
// ContentStore and are tested there, once. What is left here is what this store adds: which formats
// it holds, and the two mime maps, which point in opposite directions and are easy to confuse.

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ART_CONTENT_TYPES, ART_EXTENSIONS, ART_SERVED_TYPES, ArtStore, isArtExtension } from '../../../src/modules/art/art.store.js';

let root: string;
let store: ArtStore;

beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'deadair-art-store-test-'));
    store = new ArtStore(root);
});

afterEach(async () => {
    await rm(root, { recursive: true, force: true });
});

describe('ArtStore', () => {
    it('holds every format the art operation declares', async () => {
        const bytes = Buffer.from('cover art');

        for (const ext of ART_EXTENSIONS) {
            const checksum = await store.write(bytes, ext);
            expect(await store.read(checksum, ext)).toEqual(bytes);
            expect(store.contentTypeFor(ext)).toBe(ART_SERVED_TYPES[ext]);
        }
    });

    it('does not hold a format it has no mime for', () => {
        expect(isArtExtension('svg')).toBe(false);
        expect(isArtExtension('sh')).toBe(false);
        expect(() => store.pathFor('a'.repeat(64), 'svg' as never)).toThrow(/extension/);
    });

    // The two maps are not inverses and the difference is deliberate. What an upstream may CALL a
    // jpeg is generous, because plenty of servers send the unregistered `image/jpg`. What we say on
    // the way out is exactly one correct mime per format.
    it('accepts more mimes on the way in than it produces on the way out', () => {
        expect(ART_CONTENT_TYPES['image/jpg']).toBe('jpg');
        expect(ART_CONTENT_TYPES['image/jpeg']).toBe('jpg');
        expect(store.contentTypeFor('jpg')).toBe('image/jpeg');
        expect(Object.values(ART_SERVED_TYPES)).not.toContain('image/jpg');
    });
});
