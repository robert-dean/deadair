// The fill is a work list and a loop: what it pins is that it asks for as many neighbours as any
// caller wants, asks nothing when no source is installed, and stops between artists when told to.

import { describe, expect, it, vi } from 'vitest';

import { FILL_NEIGHBOURS, SimilarityFill } from '../../../src/modules/similarity/similarity.fill.js';
import type { SimilarityService } from '../../../src/modules/similarity/similarity.service.js';
import type { CatalogArtistKey, SimilarityStoreRepository } from '../../../src/modules/similarity/similarity.store.repository.js';

const artist = (name: string): CatalogArtistKey => ({ id: name, name, artistKey: name.toLowerCase() });

function build(owed: CatalogArtistKey[], hasSimilarity = true) {
    const similarTo = vi.fn(async () => []);
    const libraryArtistsUnasked = vi.fn(async () => owed);
    const fill = new SimilarityFill(
        { hasSimilarity: () => hasSimilarity, similarTo } as unknown as SimilarityService,
        { libraryArtistsUnasked } as unknown as SimilarityStoreRepository,
    );
    return { fill, similarTo, libraryArtistsUnasked };
}

describe('SimilarityFill', () => {
    it('asks about every owed artist, for as many neighbours as any caller asks for', async () => {
        const { fill, similarTo, libraryArtistsUnasked } = build([artist('Portishead'), artist('Tricky')]);

        expect(await fill.fillPending(50)).toEqual({ scanned: 2, asked: 2 });
        expect(libraryArtistsUnasked).toHaveBeenCalledWith(50, FILL_NEIGHBOURS);
        expect(similarTo.mock.calls).toEqual([
            [{ name: 'Portishead' }, FILL_NEIGHBOURS],
            [{ name: 'Tricky' }, FILL_NEIGHBOURS],
        ]);
    });

    it('reads no work list when nothing can say who resembles whom', async () => {
        const { fill, similarTo, libraryArtistsUnasked } = build([artist('Portishead')], false);

        expect(await fill.fillPending(50)).toEqual({ scanned: 0, asked: 0 });
        expect(libraryArtistsUnasked).not.toHaveBeenCalled();
        expect(similarTo).not.toHaveBeenCalled();
    });

    it('stops between artists once its run is out of time', async () => {
        const stop = new AbortController();
        const { fill, similarTo } = build([artist('Portishead'), artist('Tricky'), artist('Massive Attack')]);
        similarTo.mockImplementationOnce(async () => {
            stop.abort();
            return [];
        });

        expect(await fill.fillPending(50, stop.signal)).toEqual({ scanned: 3, asked: 1 });
        expect(similarTo).toHaveBeenCalledOnce();
    });
});
