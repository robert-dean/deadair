import { Injectable } from 'injectkit';
import { httpError } from '@maroonedsoftware/errors';
import { Pagination } from '../shared/types/pagination.js';
import { Artist, CatalogQueryInput, RateInput } from './types/catalog.types.js';
import { ArtistsRepository } from './artists.repository.js';
import { ratingToColumn, withRating } from './rating.js';
import { parseAndValidate, parseAndValidateArray } from '@maroonedsoftware/zod';

@Injectable()
export class ArtistsService {
    constructor(private readonly artistsRepository: ArtistsRepository) {}

    async listArtists(query: CatalogQueryInput): Promise<{ meta: Pagination; data: Artist[] }> {
        const { page, pageSize, sort, search, sortBy } = query;
        const { total, data } = await this.artistsRepository.listArtists({ limit: pageSize, offset: page * pageSize, sort, search, sortBy });
        return { meta: { total, page, pageSize, sort }, data: await parseAndValidateArray(data.map(withRating), Artist) };
    }

    /** @throws 404 when no such artist exists, and equally when it was merged into another. */
    async getArtist(id: string): Promise<Artist> {
        const row = await this.artistsRepository.findArtist(id);
        if (row === undefined) throw httpError(404).withDetails({ message: `artist "${id}" is not in the catalog` });
        return parseAndValidate(withRating(row), Artist);
    }

    /**
     * What the station thinks of this artist, which is the widest an opinion gets: a dislike here
     * takes every record they are credited on out of rotation.
     *
     * The answer is the artist RE-READ rather than the request echoed back with a new rating on it,
     * which is what keeps the joined columns — the counts, the resolved cover — true in it.
     *
     * @throws 404 when no such artist exists, and equally when it was merged into another.
     */
    async rateArtist(id: string, input: RateInput): Promise<Artist> {
        const rated = await this.artistsRepository.setRating(id, ratingToColumn(input.rating));
        if (!rated) throw httpError(404).withDetails({ message: `artist "${id}" is not in the catalog` });
        return await this.getArtist(id);
    }
}
