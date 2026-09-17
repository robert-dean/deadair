// The picture a kind of break wears: which bytes the station holds for a kind, and the two rules
// that decide when they change. A real `ArtStore` over a temp directory, and a repository double
// standing in for the one table, because everything interesting here is about WHEN a row is written
// rather than about SQL.

import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Logger } from '@maroonedsoftware/logger';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { MultipartBody } from '@maroonedsoftware/multipart';
import { IsHttpError } from '@maroonedsoftware/errors';

import { ArtRepository, type ArtAsset, type ArtAssetBytes } from '../../../src/modules/art/art.repository.js';
import { ArtStore } from '../../../src/modules/art/art.store.js';
import { BREAK_ART_SOURCE } from '../../../src/modules/art/break.art.js';
import { BreakArtworkService } from '../../../src/modules/art/break.artwork.service.js';

/** A PNG as far as anything here is concerned: the signature, then whatever makes it its own bytes. */
const png = (tail: string) => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(tail)]);
const jpg = (tail: string) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from(tail)]);

let root: string;
let shippedRoot: string;
let store: ArtStore;

const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), trace: vi.fn() } as unknown as Logger;

/**
 * The one table, in memory, keyed the way Postgres keys it.
 *
 * `recordSuccess` upserts on the source URL and keeps the id, which is the property the whole design
 * rests on — a replaced picture keeps the URL already on the wire — so the double has to have it or
 * the tests would pass against a repository that did not.
 */
const fakeRepository = () => {
    const rows = new Map<string, ArtAsset>();
    let nextId = 1;

    const repository = {
        findBySourceUrl: vi.fn(async (sourceUrl: string) => rows.get(sourceUrl)),
        findBySourcePrefix: vi.fn(async (prefix: string) => [...rows.values()].filter(row => row.sourceUrl.startsWith(prefix))),
        recordSuccess: vi.fn(async (sourceUrl: string, bytes: ArtAssetBytes) => {
            const row: ArtAsset = { id: rows.get(sourceUrl)?.id ?? `asset-${nextId++}`, sourceUrl, ...bytes };
            rows.set(sourceUrl, row);
            return row;
        }),
    };

    return { repository: repository as unknown as ArtRepository, rows };
};

const service = (repository: ArtRepository) => new BreakArtworkService(repository, store, shippedRoot, logger);

/** A multipart body carrying one file, which is all any of these routes accepts. */
const multipartOf = (bytes?: Buffer) =>
    ({
        parse: async (
            onFile: (field: string, stream: AsyncIterable<Uint8Array>, filename: string, encoding: string, mime: string) => Promise<void>,
        ) => {
            if (bytes !== undefined) {
                await onFile(
                    'file',
                    (async function* () {
                        yield bytes;
                    })(),
                    'whatever.png',
                    '7bit',
                    'image/png',
                );
            }
            return new Map();
        },
    }) as unknown as MultipartBody;

/** The status an http error carries, or 200 for a call that did not throw one. */
const status = async (work: Promise<unknown>): Promise<number> => {
    try {
        await work;
        return 200;
    } catch (error) {
        return IsHttpError(error) ? error.statusCode : 500;
    }
};

beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'deadair-break-art-test-'));
    shippedRoot = join(root, 'shipped');
    store = new ArtStore(join(root, 'store'));
    await mkdir(shippedRoot, { recursive: true });
    await writeFile(join(shippedRoot, 'weather.png'), png('weather'));
    await writeFile(join(shippedRoot, 'news.png'), png('news'));
    vi.clearAllMocks();
});

afterEach(async () => {
    await rm(root, { recursive: true, force: true });
});

describe('seed', () => {
    it('takes in a picture for every kind this repository ships one for', async () => {
        const { repository, rows } = fakeRepository();

        expect(await service(repository).seed()).toBe(2);
        expect([...rows.keys()].sort()).toEqual([`${BREAK_ART_SOURCE}/news`, `${BREAK_ART_SOURCE}/weather`]);

        // The bytes are in the station's own store, so the route that already serves art serves
        // these with no idea they are anything unusual.
        const weather = rows.get(`${BREAK_ART_SOURCE}/weather`)!;
        expect(weather.ext).toBe('png');
        expect(await store.read(weather.checksum!, 'png')).toEqual(png('weather'));
    });

    it('leaves a kind the station already holds a picture for alone', async () => {
        // The failure this is about: an operator replaces the weather picture, and the next boot
        // puts the shipped one back over the top of it. `PadLibrary.seed` guards the whole library
        // for this reason; here the unit is one kind.
        const { repository, rows } = fakeRepository();
        const uploaded = png('somebody else entirely');
        await service(repository).replace('weather', uploaded);
        const replaced = rows.get(`${BREAK_ART_SOURCE}/weather`)!;

        expect(await service(repository).seed()).toBe(1);
        expect(rows.get(`${BREAK_ART_SOURCE}/weather`)).toEqual(replaced);
    });

    it('is a no-op rather than a fault when nothing is shipped at all', async () => {
        // What the pads directory has looked like for two commits: present and empty.
        await rm(shippedRoot, { recursive: true, force: true });
        await mkdir(shippedRoot, { recursive: true });
        const { repository, rows } = fakeRepository();

        expect(await service(repository).seed()).toBe(0);
        expect(rows.size).toBe(0);
    });

    it('carries on past a picture it cannot read, so one bad file costs one kind', async () => {
        await writeFile(join(shippedRoot, 'weather.png'), Buffer.from('<!DOCTYPE html>'));
        const { repository, rows } = fakeRepository();

        await service(repository).seed();

        expect([...rows.keys()]).toEqual([`${BREAK_ART_SOURCE}/news`]);
        expect(logger.warn).toHaveBeenCalled();
    });

    it('never writes a row without bytes, which is what keeps these out of the fetch queue', async () => {
        // `art_assets_pending_idx` is partial on `checksum is null`, so a row written WITH its bytes
        // is never in the sweeper's queue and its `deadair:` key is never handed to `fetch`.
        const { repository, rows } = fakeRepository();
        await service(repository).seed();

        for (const row of rows.values()) {
            expect(row.checksum).toBeDefined();
            expect(row.sourceUrl.startsWith('deadair:')).toBe(true);
        }
    });
});

describe('replace', () => {
    it('keeps the id and changes the checksum, so a URL already on the wire still works', async () => {
        const { repository, rows } = fakeRepository();
        const service_ = service(repository);
        await service_.seed();
        const before = rows.get(`${BREAK_ART_SOURCE}/weather`)!;

        const after = await service_.replace('weather', png('an operator of their own'));

        expect(after?.id).toBe(before.id);
        expect(after?.checksum).not.toBe(before.checksum);
    });

    it('takes the format from the bytes and not from anything anybody claims', async () => {
        const { repository } = fakeRepository();

        const asset = await service(repository).replace('weather', jpg('actually a jpeg'));

        expect(asset?.ext).toBe('jpg');
        expect(asset?.contentType).toBe('image/jpeg');
    });

    it('refuses bytes that are not an image the station serves', async () => {
        const { repository, rows } = fakeRepository();

        expect(await service(repository).replace('weather', Buffer.from('<!DOCTYPE html>'))).toBeUndefined();
        expect(rows.size).toBe(0);
    });

    it('refuses a kind that would escape the shipped directory', async () => {
        // `segments.kind` is free text an operator controls, and it reaches `join(root, kind)` on the
        // revert side. Refused rather than normalised, so a kind this rejects has no picture rather
        // than quietly becoming a different kind.
        const { repository, rows } = fakeRepository();
        const service_ = service(repository);

        for (const kind of ['../../etc/passwd', 'weather/../news', '', '   ', '.hidden']) {
            expect(await service_.replace(kind, png('x'))).toBeUndefined();
        }
        expect(rows.size).toBe(0);
    });
});

describe('revert', () => {
    it('puts the shipped bytes back under the same id', async () => {
        const { repository, rows } = fakeRepository();
        const service_ = service(repository);
        await service_.seed();
        const shipped = rows.get(`${BREAK_ART_SOURCE}/weather`)!;
        await service_.replace('weather', png('an operator of their own'));

        const reverted = await service_.revert('weather');

        expect(reverted?.id).toBe(shipped.id);
        expect(reverted?.checksum).toBe(shipped.checksum);
    });

    it('picks up a picture this repository has improved since the station first booted', async () => {
        // The reason the shipped files are read at revert rather than copied into the volume once:
        // an upgrade changes what Revert gives you back.
        const { repository } = fakeRepository();
        const service_ = service(repository);
        await service_.seed();
        await writeFile(join(shippedRoot, 'weather.png'), png('redrawn in a later release'));

        const reverted = await service_.revert('weather');

        expect(await store.read(reverted!.checksum!, 'png')).toEqual(png('redrawn in a later release'));
    });

    it('answers nothing for a kind this repository ships no picture for, and leaves the upload standing', async () => {
        const { repository, rows } = fakeRepository();
        const service_ = service(repository);
        await service_.replace('talkbreak', png('an operator of their own'));
        const held = rows.get(`${BREAK_ART_SOURCE}/talkbreak`)!;

        expect(await service_.revert('talkbreak')).toBeUndefined();
        expect(rows.get(`${BREAK_ART_SOURCE}/talkbreak`)).toEqual(held);
    });
});

describe('list', () => {
    it("says which pictures are the station's own and which somebody uploaded", async () => {
        const { repository } = fakeRepository();
        const service_ = service(repository);
        await service_.seed();
        await service_.replace('weather', png('an operator of their own'));
        await service_.replace('talkbreak', png('one with no default at all'));

        expect(await service_.list()).toEqual([
            { kind: 'news', url: expect.stringMatching(/^art\/.+\/cover\.png$/), source: 'shipped', hasShipped: true },
            { kind: 'talkbreak', url: expect.stringMatching(/^art\/.+\/cover\.png$/), source: 'operator', hasShipped: false },
            { kind: 'weather', url: expect.stringMatching(/^art\/.+\/cover\.png$/), source: 'operator', hasShipped: true },
        ]);
    });

    it('leaves out a kind the station holds no bytes for, which is a break wearing the logo', async () => {
        const { repository } = fakeRepository();

        expect(await service(repository).list()).toEqual([]);
    });
});

describe('the routes', () => {
    it('answers the whole listing after a replace, which is what the console redraws from', async () => {
        const { repository } = fakeRepository();
        const service_ = service(repository);
        await service_.seed();

        const listing = await service_.replaceBreak('weather', multipartOf(png('an operator of their own')));

        expect(listing.breaks.map(one => [one.kind, one.source])).toEqual([
            ['news', 'shipped'],
            ['weather', 'operator'],
        ]);
    });

    it('refuses a file that is not an image, whatever the browser called it', async () => {
        // The declared type on that part is `image/png` and nothing reads it: an HTML file served
        // back from the station's own origin under a stable URL is the reason this route sniffs.
        const { repository, rows } = fakeRepository();

        expect(await status(service(repository).replaceBreak('weather', multipartOf(Buffer.from('<!DOCTYPE html>'))))).toBe(415);
        expect(rows.size).toBe(0);
    });

    it('refuses an upload carrying nothing at all', async () => {
        const { repository } = fakeRepository();

        expect(await status(service(repository).replaceBreak('weather', multipartOf()))).toBe(400);
        expect(await status(service(repository).replaceBreak('weather', multipartOf(Buffer.alloc(0))))).toBe(400);
    });

    it('refuses a kind that would escape the shipped directory before reading a byte', async () => {
        const { repository } = fakeRepository();

        expect(await status(service(repository).replaceBreak('../../etc/passwd', multipartOf(png('x'))))).toBe(400);
    });

    it('404s a revert for a kind this repository ships nothing for', async () => {
        // Not a fault: an operator asking for a default that does not exist. Their own picture is
        // left where it is, because a break with no picture would be a silent change to what airs.
        const { repository, rows } = fakeRepository();
        const service_ = service(repository);
        await service_.replaceBreak('talkbreak', multipartOf(png('an operator of their own')));
        const held = rows.get(`${BREAK_ART_SOURCE}/talkbreak`)!;

        expect(await status(service_.revertBreak('talkbreak'))).toBe(404);
        expect(rows.get(`${BREAK_ART_SOURCE}/talkbreak`)).toEqual(held);
    });
});
