// The inbox: what counts as a deliverable segment, what the directory means, and the fact that
// scanning twice does not give the station two copies of the same ident. The repository is faked,
// because the idempotency this checks is the SCAN's (same file, one import call per unique
// checksum); the row-level half lives in the partial unique index and is the database's job.

import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Logger } from '@maroonedsoftware/logger';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SegmentLibrary } from '../../../src/modules/render/segment.library.js';
import type { ImportedSegment, SegmentRepository } from '../../../src/modules/render/segment.repository.js';
import { SegmentStore } from '../../../src/modules/render/segment.store.js';

let root: string;
let inbox: string;
let store: SegmentStore;

const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), trace: vi.fn() } as unknown as Logger;

beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'deadair-segment-library-test-'));
    inbox = join(root, 'inbox');
    store = new SegmentStore(join(root, 'store'));
    vi.clearAllMocks();
});

afterEach(async () => {
    await rm(root, { recursive: true, force: true });
});

/** A repository that remembers what it was asked to import rather than touching a database. */
const fakeRepository = () => {
    const imports: ImportedSegment[] = [];
    const known = new Set<string>();

    const repository = {
        importFile: vi.fn(async (imported: ImportedSegment) => {
            imports.push(imported);
            const created = !known.has(imported.audioChecksum);
            known.add(imported.audioChecksum);
            return {
                created,
                segment: {
                    id: `segment-${known.size}`,
                    kind: imported.kind,
                    state: 'ready' as const,
                    label: imported.label,
                    source: 'library',
                    audioChecksum: imported.audioChecksum,
                    audioExt: imported.audioExt,
                },
            };
        }),
    } as unknown as SegmentRepository;

    return { repository, imports };
};

const drop = async (relative: string, contents: string): Promise<void> => {
    const path = join(inbox, relative);
    await mkdir(join(path, '..'), { recursive: true });
    await writeFile(path, contents);
};

const libraryOver = (repository: SegmentRepository): SegmentLibrary => new SegmentLibrary(store, repository, inbox, logger);

describe('SegmentLibrary', () => {
    it('creates the inbox so an operator can find where to drop files', async () => {
        const { repository } = fakeRepository();

        const result = await libraryOver(repository).scan();

        expect(result).toEqual({ scanned: 0, imported: 0, skipped: 0 });
        // The directory now exists, which the second scan proves by finding a file in it.
        await drop('ident.mp3', 'audio');
        expect((await libraryOver(repository).scan()).imported).toBe(1);
    });

    it('takes a dropped file into the library and copies its bytes into the store', async () => {
        const { repository, imports } = fakeRepository();
        await drop('station-ident.mp3', 'audio');

        const result = await libraryOver(repository).scan();

        expect(result).toEqual({ scanned: 1, imported: 1, skipped: 0 });
        expect(imports[0]?.sourcePath).toBe('station-ident.mp3');
        expect(await store.read(imports[0]!.audioChecksum, 'mp3')).toEqual(Buffer.from('audio'));
    });

    // The bytes are copied on import precisely so this is true: the inbox is an inbox, and emptying
    // it must not take a segment off the air.
    it('keeps the audio after the inbox file is deleted', async () => {
        const { repository, imports } = fakeRepository();
        await drop('station-ident.mp3', 'audio');
        await libraryOver(repository).scan();

        await rm(join(inbox, 'station-ident.mp3'));

        expect(await store.read(imports[0]!.audioChecksum, 'mp3')).toEqual(Buffer.from('audio'));
    });

    it('names the kind after the directory a file sits in, and calls a loose file an ident', async () => {
        const { repository, imports } = fakeRepository();
        await drop('loose.mp3', 'one');
        await drop('stinger/sweep.mp3', 'two');

        await libraryOver(repository).scan();

        expect(imports.find(i => i.sourcePath === 'loose.mp3')?.kind).toBe('ident');
        expect(imports.find(i => i.sourcePath === join('stinger', 'sweep.mp3'))?.kind).toBe('stinger');
    });

    it('reads a filename as something a listener could be shown', async () => {
        const { repository, imports } = fakeRepository();
        await drop('top_of-the hour.mp3', 'audio');

        await libraryOver(repository).scan();

        expect(imports[0]?.label).toBe('top of the hour');
    });

    // Content-addressed, so the same recording under two names is one segment rather than two.
    it('recognises the same recording delivered twice', async () => {
        const { repository, imports } = fakeRepository();
        await drop('ident.mp3', 'the same audio');
        await drop('ident-copy.mp3', 'the same audio');

        const result = await libraryOver(repository).scan();

        expect(imports[0]?.audioChecksum).toBe(imports[1]?.audioChecksum);
        expect(result).toMatchObject({ scanned: 2, imported: 1 });
    });

    it('imports nothing new on a second pass over an unchanged inbox', async () => {
        const { repository } = fakeRepository();
        await drop('ident.mp3', 'audio');
        const library = libraryOver(repository);
        await library.scan();

        expect(await library.scan()).toEqual({ scanned: 1, imported: 0, skipped: 0 });
    });

    it('passes over anything that is not audio, without saying anything about it', async () => {
        const { repository } = fakeRepository();
        await drop('notes.txt', 'not audio');
        await drop('.DS_Store', 'not audio either');

        const result = await libraryOver(repository).scan();

        // The dotfile is not even counted: it arrives in every directory a Mac has looked at, and
        // reporting it as a file passed over on every pass would train the operator to ignore the
        // number that matters.
        expect(result).toEqual({ scanned: 0, imported: 0, skipped: 1 });
        expect(logger.warn).not.toHaveBeenCalled();
    });

    it('takes in every format the station can serve, not just mp3', async () => {
        const { repository, imports } = fakeRepository();
        await drop('one.mp3', 'a');
        await drop('two.wav', 'b');
        await drop('three.ogg', 'c');
        await drop('four.flac', 'd');
        await drop('five.m4a', 'e');

        const result = await libraryOver(repository).scan();

        expect(result).toMatchObject({ scanned: 5, imported: 5, skipped: 0 });
        expect(imports.map(i => i.audioExt).sort()).toEqual(['flac', 'm4a', 'mp3', 'ogg', 'wav']);
    });

    // Audio the station cannot serve is refused OUT LOUD, because "skipped: 40" tells an operator
    // holding a folder of aiffs nothing about what to do next.
    it('says so when the inbox holds audio in a format it cannot serve', async () => {
        const { repository } = fakeRepository();
        await drop('ident.aiff', 'audio');

        const result = await libraryOver(repository).scan();

        expect(result).toEqual({ scanned: 0, imported: 0, skipped: 1 });
        expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('does not serve'), expect.objectContaining({ format: 'aiff' }));
    });

    // One bad file must not cost the operator the other forty.
    it('carries on past a file it cannot read', async () => {
        const { repository, imports } = fakeRepository();
        await drop('good.mp3', 'audio');
        await drop('unreadable.mp3', 'audio');
        await chmod(join(inbox, 'unreadable.mp3'), 0o000);

        const result = await libraryOver(repository).scan();

        expect(result).toMatchObject({ imported: 1, skipped: 1 });
        expect(imports).toHaveLength(1);
        expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('could not read'), { file: 'unreadable.mp3' });
    });
});
