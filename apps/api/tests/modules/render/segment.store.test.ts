import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { SEGMENT_EXTENSIONS, SegmentStore } from '../../../src/modules/render/segment.store.js';

let root: string;
let store: SegmentStore;

beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'deadair-segment-store-test-'));
    store = new SegmentStore(root);
});

afterEach(async () => {
    await rm(root, { recursive: true, force: true });
});

const sha256 = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');

describe('SegmentStore', () => {
    it('writes bytes under their own checksum, sharded', async () => {
        const bytes = Buffer.from('a station ident');

        const checksum = await store.write(bytes, 'mp3');

        expect(checksum).toBe(sha256(bytes));
        expect(await readFile(join(root, checksum.slice(0, 2), `${checksum}.mp3`))).toEqual(bytes);
    });

    it('reads back what it wrote', async () => {
        const bytes = Buffer.from('a station ident');
        const checksum = await store.write(bytes, 'mp3');

        expect(await store.read(checksum, 'mp3')).toEqual(bytes);
    });

    // The same recording delivered twice is one segment, and this is the half of that which is
    // true on disk. The other half is the partial unique index the repository conflicts on.
    it('writes the same bytes to one file however many times it is asked', async () => {
        const bytes = Buffer.from('a station ident');

        const first = await store.write(bytes, 'mp3');
        const second = await store.write(bytes, 'mp3');

        expect(second).toBe(first);
        expect(await store.read(first, 'mp3')).toEqual(bytes);
    });

    // A segment whose file has gone missing is a segment that cannot air, which the service turns
    // into a 404 and the director skips. It is not a crash on the boundary.
    it('treats a missing file as nothing to play rather than an error', async () => {
        expect(await store.read(sha256(Buffer.from('never written')), 'mp3')).toBeUndefined();
    });

    it('refuses a checksum that is not a sha256', async () => {
        expect(() => store.pathFor('../../etc/passwd', 'mp3')).toThrow(/sha256/);
        expect(() => store.pathFor('abc', 'mp3')).toThrow(/sha256/);
        expect(() => store.pathFor(`${'a'.repeat(63)}Z`, 'mp3')).toThrow(/sha256/);
    });

    it('refuses an extension the station does not serve', async () => {
        const checksum = sha256(Buffer.from('a station ident'));

        expect(() => store.pathFor(checksum, 'sh' as never)).toThrow(/extension/);
        expect(() => store.pathFor(checksum, 'aiff' as never)).toThrow(/extension/);
    });

    // The store holds every format the audio operation declares a mime for, because the service
    // answers with that mime and the router sets ctx.type from it. One is not more real than
    // another: a wav is written, read and served as a wav.
    it('holds every format the contract declares', async () => {
        const bytes = Buffer.from('a station ident');

        for (const ext of SEGMENT_EXTENSIONS) {
            const checksum = await store.write(bytes, ext);
            expect(await store.read(checksum, ext)).toEqual(bytes);
        }
    });

    // The read path takes both halves from a database row, so it declines rather than throws: a
    // hand-edited row should read as a segment with no audio, not as a 500.
    it('declines to read a traversal attempt without touching the filesystem', async () => {
        await writeFile(join(root, 'secret'), 'not audio');

        expect(await store.read('../secret', 'mp3')).toBeUndefined();
        expect(await store.read(sha256(Buffer.from('x')), '../../etc/passwd')).toBeUndefined();
    });
});
