// The pad library: what a directory means, what a filename becomes, and the one thing that makes a
// pad different from a segment — that dropping a new file under a name the station is already
// saying REPLACES what that slot holds rather than adding a second sound to hit.
//
// `ingest` is the seam both doors share, so its own block covers what the scan cannot reach: a sound
// arriving as BYTES has to be written into this directory, because that directory is what a backup
// carries and the content store is rewritten from it.
//
// The repository is faked, as it is for the segment libraryDir and for the same reason: what is under
// test is the SCAN's reading of a directory. The uniqueness itself lives in the partial index and
// is the database's job.

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Logger } from '@maroonedsoftware/logger';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PadLibrary, padNameOf } from '../../../src/modules/render/pad.library.js';
import { PAD_SOURCES, type ImportedPad, type PadRepository } from '../../../src/modules/render/pad.repository.js';
import type { PadSetRepository } from '../../../src/modules/render/pad.set.repository.js';
import { SegmentStore } from '../../../src/modules/render/segment.store.js';
import type { AnalysisService } from '../../../src/modules/analysis/analysis.service.js';
import type { AppConfig } from '@maroonedsoftware/appconfig';
import type { AudioUrlSigner } from '../../../src/modules/playout/audio.url.signer.js';

/** Hands URLs back unsigned: what is signed and how is `AudioUrlSigner`'s own test. */
const signer = { sign: (url: string) => url } as unknown as AudioUrlSigner;

let root: string;
let libraryDir: string;
let store: SegmentStore;

const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), trace: vi.fn() } as unknown as Logger;

// A station with no analyzer, which is the ordinary case and the one every assertion here is about:
// measuring a pad must cost nothing and change nothing about what the scan reports.
const analysis = { measureAudio: vi.fn(async () => undefined) } as unknown as AnalysisService;

// A set store that remembers what went on what, with the one rule the real one enforces: a set may
// not answer to two names, because a script writes a name and resolution happens inside a set.
const sets = {
    ensure: vi.fn(async ({ key }: { key: string }) => ({ id: `set-${key}`, key, label: key, position: 0, pads: 0 })),
    add: vi.fn(async () => 'added' as const),
} as unknown as PadSetRepository;
const config = { get: vi.fn((_key: string, fallback: string) => fallback) } as unknown as AppConfig;

beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'deadair-pad-library-test-'));
    libraryDir = join(root, 'libraryDir');
    store = new SegmentStore(join(root, 'store'));
    vi.clearAllMocks();
});

afterEach(async () => {
    await rm(root, { recursive: true, force: true });
});

/** A repository that keeps a rack in memory, with the same slot identity the table enforces. */
const fakeRepository = () => {
    const imports: ImportedPad[] = [];
    const slots = new Map<string, string>();

    const repository = {
        importFile: vi.fn(async (imported: ImportedPad) => {
            imports.push(imported);
            const slot = `${imported.board}/${imported.name}`;
            const held = slots.get(slot);
            slots.set(slot, imported.audioChecksum);

            const outcome = held === undefined ? 'created' : held === imported.audioChecksum ? 'unchanged' : 'replaced';

            return {
                outcome,
                pad: {
                    id: `pad-${slot}`,
                    board: imported.board,
                    name: imported.name,
                    label: imported.label,
                    audioChecksum: imported.audioChecksum,
                    audioExt: imported.audioExt,
                    source: imported.source,
                    state: 'active' as const,
                },
            };
        }),
    } as unknown as PadRepository;

    return { repository, imports };
};

const write = async (relative: string, bytes: string): Promise<void> => {
    const path = join(libraryDir, relative);
    await mkdir(join(path, '..'), { recursive: true });
    await writeFile(path, bytes);
};

describe('padNameOf', () => {
    it('is the filename stem as a token a prompt can carry', () => {
        expect(padNameOf('airhorn.mp3')).toBe('airhorn');
        expect(padNameOf('wisecrack/Air Horn 2.wav')).toBe('air-horn-2');
    });

    it('collapses spacing and punctuation so one sound is not two names', () => {
        expect(padNameOf('air_horn.mp3')).toBe(padNameOf('Air  Horn.mp3'));
    });

    it('answers nothing for a file with no name left, which is a file that cannot be a pad', () => {
        // Not `.mp3`: Node reads a leading-dot file as having no extension at all, so its stem is
        // the whole name. It never reaches here anyway, because the scan drops dotfiles one step
        // earlier — see the dotfile case below.
        expect(padNameOf('---.mp3')).toBeUndefined();
        expect(padNameOf('   .wav')).toBeUndefined();
    });
});

describe('PadLibrary.scan', () => {
    it('puts a directory on its own board and a loose file on the station board', async () => {
        const { repository, imports } = fakeRepository();
        await write('wisecrack/airhorn.mp3', 'one');
        await write('rimshot.mp3', 'two');

        const result = await new PadLibrary(store, repository, sets, libraryDir, analysis, config, logger, signer).scan();

        expect(result).toMatchObject({ scanned: 2, imported: 2, replaced: 0, skipped: 0 });
        expect(imports.map(one => `${one.board}/${one.name}`).sort()).toEqual(['station/rimshot', 'wisecrack/airhorn']);
    });

    it('is silent on a second pass over a directory nobody has touched', async () => {
        const { repository } = fakeRepository();
        await write('wisecrack/airhorn.mp3', 'one');
        const library = new PadLibrary(store, repository, sets, libraryDir, analysis, config, logger, signer);

        await library.scan();
        const again = await library.scan();

        // Seen, and nothing done about it: the station already holds this sound under this name.
        expect(again).toMatchObject({ scanned: 1, imported: 0, replaced: 0 });
    });

    it('replaces what a slot holds when the file under a name changes', async () => {
        const { repository } = fakeRepository();
        await write('wisecrack/airhorn.mp3', 'the first one');
        const library = new PadLibrary(store, repository, sets, libraryDir, analysis, config, logger, signer);
        await library.scan();

        await write('wisecrack/airhorn.mp3', 'a better one');
        const again = await library.scan();

        // The whole difference from a segment: two files, one slot, and every script that ever
        // wrote `[sfx:airhorn]` now plays the second one without being touched.
        expect(again).toMatchObject({ imported: 0, replaced: 1 });
    });

    it('refuses audio it cannot serve out loud, and says what it does serve', async () => {
        const { repository, imports } = fakeRepository();
        await write('wisecrack/airhorn.opus', 'one');

        const result = await new PadLibrary(store, repository, sets, libraryDir, analysis, config, logger, signer).scan();

        expect(result).toMatchObject({ scanned: 0, skipped: 1 });
        expect(imports).toHaveLength(0);
        expect(logger.warn).toHaveBeenCalledWith(
            expect.stringContaining('format the station does not serve'),
            expect.objectContaining({ format: 'opus' }),
        );
    });

    it('passes over a file whose name no script could write', async () => {
        const { repository, imports } = fakeRepository();
        await write('wisecrack/---.mp3', 'one');

        const result = await new PadLibrary(store, repository, sets, libraryDir, analysis, config, logger, signer).scan();

        expect(result).toMatchObject({ skipped: 1 });
        expect(imports).toHaveLength(0);
    });

    it('does not count a dotfile as a delivery', async () => {
        const { repository } = fakeRepository();
        await write('.DS_Store', 'not a delivery');
        await write('wisecrack/.DS_Store', 'nor this');

        const result = await new PadLibrary(store, repository, sets, libraryDir, analysis, config, logger, signer).scan();

        expect(result).toMatchObject({ scanned: 0, imported: 0, skipped: 0 });
    });

    it('makes the libraryDir when it is missing, so there is a place to drop files', async () => {
        const { repository } = fakeRepository();

        const result = await new PadLibrary(store, repository, sets, libraryDir, analysis, config, logger, signer).scan();

        expect(result).toMatchObject({ scanned: 0 });
        // The directory now exists: a second scan reads it rather than catching its way past a
        // missing path.
        await write('rimshot.mp3', 'one');
        expect(await new PadLibrary(store, repository, sets, libraryDir, analysis, config, logger, signer).scan()).toMatchObject({ imported: 1 });
    });
});

// The set a directory produces. This is what keeps dropping files in a folder a complete answer:
// the pad reaches the library AND something a presenter can be pointed at, with no console visit.
describe('PadLibrary joining a pad to its set', () => {
    it('makes the set named after the directory and puts the pad on it', async () => {
        const { repository } = fakeRepository();
        await write('wisecrack/airhorn.mp3', 'one');

        await new PadLibrary(store, repository, sets, libraryDir, analysis, config, logger, signer).scan();

        expect(sets.ensure).toHaveBeenCalledWith({ key: 'wisecrack', label: 'wisecrack' });
        expect(sets.add).toHaveBeenCalledWith('set-wisecrack', 'pad-wisecrack/airhorn');
    });

    it('joins on EVERY pass, not only the one that created the row', async () => {
        // A set an operator deleted should come back when the files are rescanned, because the
        // directory is still the claim. A join that only ran on `created` would leave the rack empty
        // and the library full, with nothing saying why.
        const { repository } = fakeRepository();
        await write('wisecrack/airhorn.mp3', 'one');
        const library = new PadLibrary(store, repository, sets, libraryDir, analysis, config, logger, signer);

        await library.scan();
        await library.scan();

        expect(sets.add).toHaveBeenCalledTimes(2);
    });

    it('reports a name the set already answers to rather than failing the scan', async () => {
        // Two directories holding airhorn.wav and one set pointed at both. The pad is in the library
        // and merely unreachable, which is a thing to tell somebody about and not a reason to lose
        // the other forty files.
        const { repository } = fakeRepository();
        (sets as unknown as { add: { mockResolvedValueOnce: (v: unknown) => void } }).add.mockResolvedValueOnce('name-taken');
        await write('wisecrack/airhorn.mp3', 'one');

        const result = await new PadLibrary(store, repository, sets, libraryDir, analysis, config, logger, signer).scan();

        expect(result).toMatchObject({ imported: 1, contested: 1, skipped: 0 });
    });

    it('costs the pad its rack and never the import when the set cannot be written', async () => {
        const { repository } = fakeRepository();
        (sets as unknown as { ensure: { mockRejectedValueOnce: (v: unknown) => void } }).ensure.mockRejectedValueOnce(new Error('no database'));
        await write('wisecrack/airhorn.mp3', 'one');

        const result = await new PadLibrary(store, repository, sets, libraryDir, analysis, config, logger, signer).scan();

        expect(result).toMatchObject({ imported: 1, skipped: 0 });
    });
});

// The shipped pack. Nothing is in it today and the copy still has the decisions in it: when it runs,
// what it is guarded on, and what a second boot does.
describe('PadLibrary.seed', () => {
    let assets: string;

    beforeEach(async () => {
        assets = join(root, 'assets');
        await mkdir(join(assets, 'station'), { recursive: true });
        await writeFile(join(assets, 'station', 'airhorn.wav'), 'shipped');
    });

    const library = (repository: PadRepository) => new PadLibrary(store, repository, sets, libraryDir, analysis, config, logger, signer);

    it('lays the pack down in a library that has never held anything', async () => {
        const { repository } = fakeRepository();

        expect(await library(repository).seed(assets)).toBe(1);
        expect(await library(repository).scan()).toMatchObject({ imported: 1 });
    });

    it('does nothing on a second boot, so a stock sound thrown away STAYS thrown away', async () => {
        // Guarded on the library holding anything rather than on each file being absent, which is
        // `persona.defaults.ts`' rule: per-file, an operator who deleted an air horn would have to
        // keep deleting it on every restart.
        const { repository } = fakeRepository();
        await library(repository).seed(assets);

        expect(await library(repository).seed(assets)).toBe(0);
    });

    it('leaves a library somebody has already filled entirely alone', async () => {
        const { repository } = fakeRepository();
        await write('wisecrack/rimshot.wav', "the operator's own");

        expect(await library(repository).seed(assets)).toBe(0);
    });

    it('costs the station its stock sounds and never its boot', async () => {
        const { repository } = fakeRepository();

        expect(await library(repository).seed(join(root, 'no-such-directory'))).toBe(0);
    });

    it('copies nothing at all from an empty pack, which is what ships today', async () => {
        const { repository } = fakeRepository();
        const empty = join(root, 'empty-assets');
        await mkdir(empty, { recursive: true });

        expect(await library(repository).seed(empty)).toBe(0);
    });
});

describe('PadLibrary.ingest', () => {
    const library = (repository: PadRepository) => new PadLibrary(store, repository, sets, libraryDir, analysis, config, logger, signer);

    it('writes the bytes into the library, because that directory is what a backup carries', async () => {
        const { repository } = fakeRepository();

        await library(repository).ingest({
            bytes: Buffer.from('a drop'),
            ext: 'wav',
            board: 'wisecrack',
            name: 'airhorn',
            label: 'Air Horn',
            source: PAD_SOURCES.upload,
        });

        expect(await readFile(join(libraryDir, 'wisecrack', 'airhorn.wav'), 'utf8')).toBe('a drop');
    });

    it('names the file after the NAME, so a re-scan finds the same pad rather than a second one', async () => {
        const { repository, imports } = fakeRepository();
        const padLibrary = library(repository);

        // The token the operator chose, against the filename they happened to upload. Saved under
        // the filename, `padNameOf` would derive `air-horn-2` on the next pass and the station would
        // hold two sounds where somebody added one.
        await padLibrary.ingest({
            bytes: Buffer.from('a drop'),
            ext: 'wav',
            board: 'wisecrack',
            name: 'airhorn',
            label: 'Air Horn',
            source: PAD_SOURCES.upload,
        });

        const rescan = await padLibrary.scan();

        expect(rescan).toMatchObject({ scanned: 1, imported: 0, replaced: 0 });
        expect(imports.map(one => `${one.board}/${one.name}`)).toEqual(['wisecrack/airhorn', 'wisecrack/airhorn']);
    });

    it('records who delivered it, which is what decides whether the console may take it back', async () => {
        const { repository, imports } = fakeRepository();

        await library(repository).ingest({
            bytes: Buffer.from('a drop'),
            ext: 'mp3',
            board: 'station',
            name: 'sting',
            label: 'Sting',
            source: PAD_SOURCES.url,
        });

        expect(imports[0]?.source).toBe('url');
        expect(imports[0]?.sourcePath).toBe(join('station', 'sting.mp3'));
    });

    it('puts it on the set named after its board, exactly as a dropped file is', async () => {
        const { repository } = fakeRepository();

        const { pad, contested } = await library(repository).ingest({
            bytes: Buffer.from('a drop'),
            ext: 'wav',
            board: 'wisecrack',
            name: 'airhorn',
            label: 'Air Horn',
            source: PAD_SOURCES.upload,
        });

        expect(sets.ensure).toHaveBeenCalledWith({ key: 'wisecrack', label: 'wisecrack' });
        expect(sets.add).toHaveBeenCalledWith('set-wisecrack', pad.id);
        expect(contested).toBe(false);
    });

    it('reports a name the set already answers to rather than throwing over it', async () => {
        const { repository } = fakeRepository();
        vi.mocked(sets.add).mockResolvedValueOnce('name-taken' as never);

        const { contested } = await library(repository).ingest({
            bytes: Buffer.from('a drop'),
            ext: 'wav',
            board: 'wisecrack',
            name: 'airhorn',
            label: 'Air Horn',
            source: PAD_SOURCES.upload,
        });

        // In the library and unreachable until somebody says where it goes, which is a thing to tell
        // an operator about rather than a reason to refuse the sound.
        expect(contested).toBe(true);
    });

    it('refuses a board that would write outside the library, rather than filing it there', async () => {
        const { repository, imports } = fakeRepository();

        await expect(
            library(repository).ingest({
                bytes: Buffer.from('a drop'),
                ext: 'wav',
                board: '../../etc',
                name: 'airhorn',
                label: 'Air Horn',
                source: PAD_SOURCES.upload,
            }),
        ).rejects.toThrow();

        expect(imports).toHaveLength(0);
    });

    it('fails rather than half-succeeding when the bytes cannot reach the disk', async () => {
        const { repository, imports } = fakeRepository();
        // A file where the board directory has to go. Everything else about the ingest is fine, and
        // the point is that it does NOT proceed: a row whose bytes are only in the content store is
        // a pad that is absent from every export and gone after a restore.
        await mkdir(libraryDir, { recursive: true });
        await writeFile(join(libraryDir, 'wisecrack'), 'not a directory');

        await expect(
            library(repository).ingest({
                bytes: Buffer.from('a drop'),
                ext: 'wav',
                board: 'wisecrack',
                name: 'airhorn',
                label: 'Air Horn',
                source: PAD_SOURCES.upload,
            }),
        ).rejects.toThrow();

        expect(imports).toHaveLength(0);
    });
});
