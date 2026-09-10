// The one audited copy of the path safety. Every guard here used to exist twice, once per store,
// which is the actual reason this was extracted: a fix to one copy would silently not reach the
// other, and what these guard against is not the kind of failure that shows up on its own.
//
// Tested over a store of its own rather than through ArtStore or SegmentStore, so the behaviour is
// pinned where it lives. What each of those adds — which formats, and what they are served as — is
// tested in its own file.

import { createHash } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
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

    // `write` now lands through the same temp-file-then-rename as `writeStream`, so a write that
    // fails partway must leave the same nothing behind: no file at the final path, and no `.tmp-`
    // left over. Forced by making the destination's shard directory a file, so `mkdir` fails without
    // any mocking.
    it('leaves nothing behind when a buffered write fails partway through', async () => {
        const bytes = Buffer.from('some bytes');
        const checksum = sha256(bytes);

        await writeFile(join(root, checksum.slice(0, 2)), 'in the way');

        await expect(store.write(bytes, 'one')).rejects.toThrow();

        expect(await store.exists(checksum, 'one')).toBe(false);
        expect(await readdir(root)).toEqual([checksum.slice(0, 2)]);
    });

    it('answers what it holds and what each format is served as', () => {
        expect(store.extensions).toEqual(['one', 'two']);
        expect(store.contentTypeFor('two')).toBe('application/two');
        expect(store.isExtension('one')).toBe(true);
        expect(store.isExtension('three')).toBe(false);
        expect(store.isExtension(undefined)).toBe(false);
    });
});

// What a disk report and an eviction sweep are built on. Between them they are the only two callers
// that care about a file this store did NOT name, which is why `list` reports one rather than
// skipping it.
describe('ContentStore.list and remove', () => {
    it('answers with every file it named, and what each one weighs', async () => {
        const first = await store.write(Buffer.from('hello'), 'one');
        const second = await store.write(Buffer.from('a longer body'), 'two');

        const listed = await store.list();

        expect(listed).toHaveLength(2);
        expect(listed).toContainEqual({ checksum: first, ext: 'one', bytes: 5 });
        expect(listed).toContainEqual({ checksum: second, ext: 'two', bytes: 13 });
    });

    // The `.tmp-` an interrupted streaming write leaves, or something a person dropped in. Reported
    // without a checksum, which is what makes it visible as unclaimed rather than invisible.
    it('reports a file it did not name, without pretending to know what it is', async () => {
        await writeFile(join(root, 'notes.txt'), 'left behind');

        expect(await store.list()).toEqual([{ bytes: 11 }]);
    });

    it('is empty for a store nothing has written to yet', async () => {
        await rm(root, { recursive: true, force: true });

        expect(await store.list()).toEqual([]);
    });

    it('deletes a file and says it did', async () => {
        const checksum = await store.write(Buffer.from('hello'), 'one');

        expect(await store.remove(checksum, 'one')).toBe(true);
        expect(await store.exists(checksum, 'one')).toBe(false);
    });

    // Every caller is reaching a state rather than performing an act, so "it was not there" is that
    // state and not an error.
    it('is content for a file that is already gone', async () => {
        expect(await store.remove('f'.repeat(64), 'one')).toBe(false);
    });

    it('refuses to delete anything that is not one of its own names', async () => {
        expect(await store.remove('../../etc/passwd', 'one')).toBe(false);
        expect(await store.remove('a'.repeat(64), 'three')).toBe(false);
    });
});

describe('ContentStore.writeStream', () => {
    /** Chunks as a plugin's drain would hand them over. */
    async function* chunks(...parts: string[]): AsyncGenerator<Uint8Array> {
        for (const part of parts) yield Buffer.from(part);
    }

    it('hashes as it goes, so the name is the same as the buffered write would produce', async () => {
        const checksum = await store.writeStream(chunks('some ', 'bytes'), 'one');

        expect(checksum).toBe(sha256(Buffer.from('some bytes')));
        expect(await readFile(join(root, checksum.slice(0, 2), `${checksum}.one`))).toEqual(Buffer.from('some bytes'));
    });

    it('is idempotent, like the buffered write', async () => {
        const first = await store.writeStream(chunks('same'), 'one');
        const second = await store.writeStream(chunks('sa', 'me'), 'one');

        expect(second).toBe(first);
        expect(await store.read(first, 'one')).toEqual(Buffer.from('same'));
    });

    it('handles an empty stream without inventing a file under the wrong name', async () => {
        const checksum = await store.writeStream(chunks(), 'one');

        expect(checksum).toBe(sha256(Buffer.alloc(0)));
        expect(await store.read(checksum, 'one')).toEqual(Buffer.alloc(0));
    });

    it('leaves nothing behind when the source fails part way through', async () => {
        async function* failing(): AsyncGenerator<Uint8Array> {
            yield Buffer.from('half a render');
            throw new Error('the engine hung up');
        }

        await expect(store.writeStream(failing(), 'one')).rejects.toThrow('the engine hung up');

        // The point of the temp file and the rename: an interrupted render must not leave a partial
        // file under a name that claims to be the whole of something. A content-addressed store has
        // no way to tell the two apart afterwards.
        expect(await readdir(root)).toEqual([]);
    });

    it('refuses a format it does not hold, before touching the filesystem', async () => {
        await expect(store.writeStream(chunks('bytes'), 'three' as 'one')).rejects.toThrow(/Not an extension/);
        expect(await readdir(root)).toEqual([]);
    });
});

describe('ContentStore.writeStreamAs', () => {
    const key = sha256(Buffer.from('a cache key, not the content'));

    it('files the bytes under the caller key rather than their own checksum', async () => {
        const written = await store.writeStreamAs(key, chunksOf('the audio'), 'one');

        expect(written).toBe(key);
        // A cache: the name answers "which voice, saying which line", so a hit is the file being
        // there and nothing else has to remember the mapping.
        expect(await store.read(key, 'one')).toEqual(Buffer.from('the audio'));
    });

    it('overwrites the same key when the content behind it changes', async () => {
        await store.writeStreamAs(key, chunksOf('the old voice'), 'one');
        await store.writeStreamAs(key, chunksOf('the new voice'), 'one');

        expect(await store.read(key, 'one')).toEqual(Buffer.from('the new voice'));
    });

    it('refuses a key that is not a checksum, so every path guard still applies', async () => {
        await expect(store.writeStreamAs('../escape', chunksOf('bytes'), 'one')).rejects.toThrow(/Not a sha256 checksum/);
        expect(await readdir(root)).toEqual([]);
    });
});

async function* chunksOf(text: string): AsyncGenerator<Uint8Array> {
    yield Buffer.from(text);
}
