import { IsHttpError } from '@maroonedsoftware/errors';
import { describe, expect, it, vi } from 'vitest';

import { ArtRepository } from '../../../src/modules/art/art.repository.js';
import { ArtService } from '../../../src/modules/art/art.service.js';
import { ArtStore } from '../../../src/modules/art/art.store.js';

const ID = '11111111-1111-4111-8111-111111111111';
const CHECKSUM = 'a'.repeat(64);
const BYTES = Buffer.from('cover art');

const service = (options: { asset?: unknown; bytes?: Buffer } = {}) => {
    const findById = vi.fn().mockResolvedValue(options.asset);
    const read = vi.fn().mockResolvedValue(options.bytes);

    return {
        service: new ArtService({ findById } as unknown as ArtRepository, { read } as unknown as ArtStore),
        findById,
        read,
    };
};

const status = async (promise: Promise<unknown>): Promise<number> => {
    try {
        await promise;
        return 200;
    } catch (error) {
        return IsHttpError(error) ? error.statusCode : 500;
    }
};

describe('ArtService.getArt', () => {
    it('serves the bytes with the checksum as the validator', async () => {
        const { service: art, read } = service({ asset: { id: ID, sourceUrl: 'https://cdn/x.jpg', checksum: CHECKSUM, ext: 'jpg' }, bytes: BYTES });

        const response = await art.getArt(ID);

        expect(response.body).toEqual(BYTES);
        expect(response.headers.etag).toBe(`"${CHECKSUM}"`);
        expect(response.headers.cacheControl).toContain('max-age=');
        expect(read).toHaveBeenCalledWith(CHECKSUM, 'jpg');
    });

    // Not `immutable`: the id is stable while the bytes under it are not, so the browser has to
    // come back eventually and the ETag decides whether it gets bytes or a 304.
    it('does not tell the browser the bytes can never change', async () => {
        const { service: art } = service({ asset: { id: ID, sourceUrl: 'https://cdn/x.jpg', checksum: CHECKSUM, ext: 'jpg' }, bytes: BYTES });

        expect((await art.getArt(ID)).headers.cacheControl).not.toContain('immutable');
    });

    it('404s an id nobody has cached', async () => {
        const { service: art, read } = service({ asset: undefined });

        expect(await status(art.getArt(ID))).toBe(404);
        expect(read).not.toHaveBeenCalled();
    });

    // A row whose fetches all failed exists so the sweeper can back off. It has no bytes and never
    // had any, so it is a 404 rather than an error: the catalog still reports the upstream URL.
    it('404s a row that has no bytes', async () => {
        const { service: art, read } = service({ asset: { id: ID, sourceUrl: 'https://cdn/gone.jpg' } });

        expect(await status(art.getArt(ID))).toBe(404);
        expect(read).not.toHaveBeenCalled();
    });

    it('404s when the file has gone missing under the row', async () => {
        const { service: art } = service({ asset: { id: ID, sourceUrl: 'https://cdn/x.jpg', checksum: CHECKSUM, ext: 'jpg' }, bytes: undefined });

        expect(await status(art.getArt(ID))).toBe(404);
    });
});
