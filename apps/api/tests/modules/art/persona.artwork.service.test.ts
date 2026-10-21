// A presenter's picture: kept under the persona's id, found again by it, and taken away on request.
// The bytes decide the type, never the name, which is the break pictures' rule held here too. And the
// portraits this repository ships for its own characters, which a persona is given only where it has
// none, so an operator's own upload always wins.

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PersonaArtworkService } from '../../../src/modules/art/persona.artwork.service.js';
import type { ArtRepository } from '../../../src/modules/art/art.repository.js';
import type { ArtStore } from '../../../src/modules/art/art.store.js';

const PERSONA = '22222222-2222-4222-8222-222222222222';
const OTHER = '33333333-3333-4333-8333-333333333333';
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...Array.from({ length: 24 }, () => 0)]);
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, ...Array.from({ length: 24 }, () => 1)]);

let shippedRoot: string;

beforeEach(async () => {
    shippedRoot = await mkdtemp(join(tmpdir(), 'deadair-portraits-'));
});

afterEach(async () => {
    await rm(shippedRoot, { recursive: true, force: true });
});

const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), trace: vi.fn() };

function build(rows: { id: string; sourceUrl: string; checksum?: string; ext?: string }[] = [], root = shippedRoot) {
    const repository = {
        findBySourceUrl: vi.fn(async (key: string) => rows.find(row => row.sourceUrl === key)),
        findBySourcePrefix: vi.fn(async (prefix: string) => rows.filter(row => row.sourceUrl.startsWith(prefix))),
        recordSuccess: vi.fn(async (key: string, bytes: { checksum: string; ext: string }) => {
            const row = { id: 'asset-1', sourceUrl: key, ...bytes };
            rows.push(row);
            return row;
        }),
        deleteBySourceUrl: vi.fn(async (key: string) => {
            rows.splice(
                rows.findIndex(row => row.sourceUrl === key),
                1,
            );
        }),
    };
    const store = { write: vi.fn(async () => 'checksum-1') };

    return {
        service: new PersonaArtworkService(repository as unknown as ArtRepository, store as unknown as ArtStore, root, logger as never),
        repository,
        store,
    };
}

/** A multipart body carrying one file, as the parser hands it to the service. */
const upload = (bytes: Buffer) =>
    ({
        parse: async (onFile: (field: string, stream: AsyncIterable<Buffer>) => Promise<void>) => {
            await onFile(
                'file',
                (async function* () {
                    yield bytes;
                })(),
            );
        },
    }) as never;

describe('PersonaArtworkService', () => {
    it('keeps a picture under the persona, and answers where it is served', async () => {
        const { service, repository } = build();

        const listed = await service.replacePortrait(PERSONA, upload(PNG));

        expect(repository.recordSuccess).toHaveBeenCalledWith(`deadair:persona-art/${PERSONA}`, expect.objectContaining({ ext: 'png' }));
        expect(listed.portraits).toEqual([{ personaId: PERSONA, url: expect.stringMatching(/^art\/asset-1\//) }]);
        expect(await service.portraitUrl(PERSONA)).toMatch(/^art\/asset-1\//);
    });

    it('refuses a file that is not a picture, whatever it is called', async () => {
        const { service, store } = build();

        await expect(service.replacePortrait(PERSONA, upload(Buffer.from('not a picture at all')))).rejects.toMatchObject({ statusCode: 415 });
        expect(store.write).not.toHaveBeenCalled();
    });

    it('refuses an id that is not a persona id, before touching anything', async () => {
        const { service, repository } = build();

        await expect(service.removePortrait('../../etc')).rejects.toMatchObject({ statusCode: 400 });
        expect(await service.portraitUrl('../../etc')).toBeUndefined();
        expect(repository.deleteBySourceUrl).not.toHaveBeenCalled();
    });

    it('takes a picture away', async () => {
        const { service } = build([{ id: 'asset-1', sourceUrl: `deadair:persona-art/${PERSONA}`, checksum: 'c', ext: 'png' }]);

        expect((await service.removePortrait(PERSONA)).portraits).toEqual([]);
        expect(await service.portraitUrl(PERSONA)).toBeUndefined();
    });
});

describe('PersonaArtworkService giving the shipped portraits', () => {
    it('gives a persona the file named after its key, typed by its bytes', async () => {
        await writeFile(join(shippedRoot, 'videoage.jpg'), JPG);
        const { service, repository } = build();

        expect(await service.seedShipped([{ id: PERSONA, key: 'videoage' }])).toBe(1);
        expect(repository.recordSuccess).toHaveBeenCalledWith(
            `deadair:persona-art/${PERSONA}`,
            expect.objectContaining({ ext: 'jpg', contentType: 'image/jpeg', byteSize: JPG.length }),
        );
    });

    it('leaves a persona that already has a portrait alone, whoever put it there', async () => {
        await writeFile(join(shippedRoot, 'videoage.jpg'), JPG);
        const { service, store } = build([{ id: 'asset-9', sourceUrl: `deadair:persona-art/${PERSONA}`, checksum: 'theirs', ext: 'png' }]);

        expect(await service.seedShipped([{ id: PERSONA, key: 'videoage' }])).toBe(0);
        expect(store.write).not.toHaveBeenCalled();
    });

    it('passes over a persona this repository ships no portrait for', async () => {
        await writeFile(join(shippedRoot, 'videoage.jpg'), JPG);
        const { service, repository } = build();

        expect(
            await service.seedShipped([
                { id: PERSONA, key: 'pirate' },
                { id: OTHER, key: 'videoage' },
            ]),
        ).toBe(1);
        expect(repository.recordSuccess).toHaveBeenCalledTimes(1);
        expect(repository.recordSuccess).toHaveBeenCalledWith(`deadair:persona-art/${OTHER}`, expect.anything());
    });

    it('skips a shipped file that is not a picture, and says which', async () => {
        await writeFile(join(shippedRoot, 'videoage.jpg'), Buffer.from('a text file with the wrong name'));
        await writeFile(join(shippedRoot, 'classic.png'), PNG);
        const { service, store } = build();

        expect(
            await service.seedShipped([
                { id: PERSONA, key: 'videoage' },
                { id: OTHER, key: 'classic' },
            ]),
        ).toBe(1);
        expect(store.write).toHaveBeenCalledTimes(1);
        expect(logger.warn).toHaveBeenCalledWith(expect.stringMatching(/videoage is not an image/), expect.anything());
    });

    it('reads nothing but pictures out of the directory, so the manifest beside them is never a portrait', async () => {
        await writeFile(join(shippedRoot, 'MANIFEST.json'), '{}');
        const { service, store } = build();

        expect(await service.seedShipped([{ id: PERSONA, key: 'MANIFEST' }])).toBe(0);
        expect(store.write).not.toHaveBeenCalled();
    });

    it('gives nothing, and fails nothing, where the shipped directory is missing', async () => {
        const { service, repository } = build([], join(shippedRoot, 'not-there'));

        expect(await service.seedShipped([{ id: PERSONA, key: 'videoage' }])).toBe(0);
        expect(repository.findBySourceUrl).not.toHaveBeenCalled();
    });

    it('costs the other personas nothing when one cannot be written', async () => {
        await writeFile(join(shippedRoot, 'videoage.jpg'), JPG);
        await writeFile(join(shippedRoot, 'classic.jpg'), JPG);
        const { service, store } = build();
        store.write.mockRejectedValueOnce(new Error('disk full'));

        expect(
            await service.seedShipped([
                { id: PERSONA, key: 'classic' },
                { id: OTHER, key: 'videoage' },
            ]),
        ).toBe(1);
        expect(logger.warn).toHaveBeenCalledWith(expect.stringMatching(/could not give classic/), { key: 'classic' });
    });
});
