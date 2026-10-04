// A presenter's picture: kept under the persona's id, found again by it, and taken away on request.
// The bytes decide the type, never the name, which is the break pictures' rule held here too.

import { describe, expect, it, vi } from 'vitest';

import { PersonaArtworkService } from '../../../src/modules/art/persona.artwork.service.js';
import type { ArtRepository } from '../../../src/modules/art/art.repository.js';
import type { ArtStore } from '../../../src/modules/art/art.store.js';

const PERSONA = '22222222-2222-4222-8222-222222222222';
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...Array.from({ length: 24 }, () => 0)]);

function build(rows: { id: string; sourceUrl: string; checksum?: string; ext?: string }[] = []) {
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

    return { service: new PersonaArtworkService(repository as unknown as ArtRepository, store as unknown as ArtStore), repository, store };
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
