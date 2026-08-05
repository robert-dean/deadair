import { Injectable } from 'injectkit';
import { httpError } from '@maroonedsoftware/errors';
import { Pagination } from '../shared/types/pagination.js';
import { Artist, CatalogQueryInput } from './types/catalog.types.js';
import { ArtistsRepository } from './artists.repository.js';
import { parseAndValidate, parseAndValidateArray } from '@maroonedsoftware/zod';

@Injectable()
export class ArtistsService {
    constructor(private readonly artistsRepository: ArtistsRepository) {}

    async listArtists(query: CatalogQueryInput): Promise<{ meta: Pagination; data: Artist[] }> {
        const { page, pageSize, sort, search } = query;
        const { total, data } = await this.artistsRepository.listArtists({ limit: pageSize, offset: page * pageSize, sort, search });
        return { meta: { total, page, pageSize, sort }, data: await parseAndValidateArray(data, Artist) };
    }

    /** @throws 404 when no such artist exists, and equally when it was merged into another. */
    async getArtist(id: string): Promise<Artist> {
        const row = await this.artistsRepository.findArtist(id);
        if (row === undefined) throw httpError(404).withDetails({ message: `artist "${id}" is not in the catalog` });
        return parseAndValidate(row, Artist);
    }
}
