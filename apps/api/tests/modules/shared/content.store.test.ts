// The one audited copy of the path safety. Every guard here used to exist twice, once per store,
// which is the actual reason this was extracted: a fix to one copy would silently not reach the
// other, and what these guard against is not the kind of failure that shows up on its own.
//
// Tested over a store of its own rather than through ArtStore or SegmentStore, so the behaviour is
// pinned where it lives. What each of those adds — which formats, and what they are served as — is
// tested in its own file.

import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ContentStore } from '../../../src/modules/shared/content.store.js';

const TYPES = { one: 'application/one', two: 'application/two' } as const;

let root: string;
let store: ContentStore<keyof typeof TYPES>;

beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'deadair-content-store-test-'));
    store = new ContentStore(root, TYPES);
});

afterEach(async () => {
    await rm(root, { recursive: true, force: true });
});

const sha256 = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');

describe('ContentStore', () => {
    it('writes bytes under their own checksum, sharded', async () => {
        const bytes = Buffer.from('some bytes');

        const checksum = await store.write(bytes, 'one');

        expect(checksum).toBe(sha256(bytes));
        expect(await readFile(join(root, checksum.slice(0, 2), `${checksum}.one`))).toEqual(bytes);
    });

    it('reads back what it wrote', async () => {
        const checksum = await store.write(Buffer.from('some bytes'), 'one');

        expect(await store.read(checksum, 'one')).toEqual(Buffer.from('some bytes'));
    });

    // The same bytes arriving twice are one file. Both stores lean on this: art dedupes two source
    // URLs for the same cover, and the segment library dedupes the same recording dropped twice.
    it('writes the same bytes to one file however many times it is asked', async () => {
        const bytes = Buffer.from('some bytes');

        const first = await store.write(bytes, 'one');
        const second = await store.write(bytes, 'one');

        expect(second).toBe(first);
        expect(await store.read(first, 'one')).toEqual(bytes);
    });

    // A file that is gone is something the caller has to be able to handle: for art it is a cache
    // miss, for a segment it is one the station skips. Neither is a 500.
    it('treats a missing file as nothing to serve rather than an error', async () => {
        expect(await store.read(sha256(Buffer.from('never written')), 'one')).toBeUndefined();
    });

    it('refuses a checksum that is not a sha256', async () => {
        expect(() => store.pathFor('../../etc/passwd', 'one')).toThrow(/sha256/);
        expect(() => store.pathFor('abc', 'one')).toThrow(/sha256/);
        expect(() => store.pathFor(`${'a'.repeat(63)}Z`, 'one')).toThrow(/sha256/);
    });

    it('refuses an extension it does not hold', async () => {
        expect(() => store.pathFor(sha256(Buffer.from('x')), 'three' as never)).toThrow(/extension/);
    });

    // The read path takes both halves from a database row, so it declines rather than throws: a
    // hand-edited row should read as nothing to serve, not as a 500.
    it('declines to read a traversal attempt without touching the filesystem', async () => {
        await writeFile(join(root, 'secret'), 'not ours');

        expect(await store.read('../secret', 'one')).toBeUndefined();
        expect(await store.read(sha256(Buffer.from('x')), '../../etc/passwd')).toBeUndefined();
    });

    it('answers what it holds and what each format is served as', () => {
        expect(store.extensions).toEqual(['one', 'two']);
        expect(store.contentTypeFor('two')).toBe('application/two');
        expect(store.isExtension('one')).toBe(true);
        expect(store.isExtension('three')).toBe(false);
        expect(store.isExtension(undefined)).toBe(false);
    });
});
