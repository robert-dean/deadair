import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ArtStore } from '../../../src/modules/art/art.store.js';

let root: string;
let store: ArtStore;

beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'deadair-art-store-test-'));
    store = new ArtStore(root);
});

afterEach(async () => {
    await rm(root, { recursive: true, force: true });
});

const sha256 = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');

describe('ArtStore', () => {
    it('writes bytes under their own checksum, sharded', async () => {
        const bytes = Buffer.from('cover art');

        const checksum = await store.write(bytes, 'jpg');

        expect(checksum).toBe(sha256(bytes));
        expect(await readFile(join(root, checksum.slice(0, 2), `${checksum}.jpg`))).toEqual(bytes);
    });

    it('reads back what it wrote', async () => {
        const bytes = Buffer.from('cover art');
        const checksum = await store.write(bytes, 'jpg');

        expect(await store.read(checksum, 'jpg')).toEqual(bytes);
    });

    it('writes the same bytes to one file however many times it is asked', async () => {
        const bytes = Buffer.from('cover art');

        const first = await store.write(bytes, 'jpg');
        const second = await store.write(bytes, 'jpg');

        expect(second).toBe(first);
        expect(await store.read(first, 'jpg')).toEqual(bytes);
    });

    it('treats a missing file as a miss rather than an error', async () => {
        expect(await store.read(sha256(Buffer.from('never written')), 'jpg')).toBeUndefined();
    });

    it('refuses a checksum that is not a sha256', async () => {
        expect(() => store.pathFor('../../etc/passwd', 'jpg')).toThrow(/sha256/);
        expect(() => store.pathFor('abc', 'jpg')).toThrow(/sha256/);
        expect(() => store.pathFor(`${'a'.repeat(63)}Z`, 'jpg')).toThrow(/sha256/);
    });

    it('refuses an extension that is not art', async () => {
        const checksum = sha256(Buffer.from('cover art'));

        expect(() => store.pathFor(checksum, 'sh' as never)).toThrow(/extension/);
    });

    // The read path takes both halves from a database row, so it declines rather than throws:
    // a hand-edited row should read as a cache miss, not as a 500.
    it('declines to read a traversal attempt without touching the filesystem', async () => {
        await writeFile(join(root, 'secret'), 'not art');

        expect(await store.read('../secret', 'jpg')).toBeUndefined();
        expect(await store.read(sha256(Buffer.from('x')), '../../etc/passwd')).toBeUndefined();
    });
});
