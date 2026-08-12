import { Injectable } from 'injectkit';
import { httpError } from '@maroonedsoftware/errors';
import { AlbumsRepository } from './albums.repository.js';
import { Pagination } from '../shared/types/pagination.js';
import { Album, CatalogQueryInput, RateInput } from './types/catalog.types.js';
import { ratingToColumn, withRating } from './rating.js';
import { parseAndValidate, parseAndValidateArray } from '@maroonedsoftware/zod';

@Injectable()
export class AlbumsService {
    constructor(private readonly albumsRepository: AlbumsRepository) {}

    async listAlbums(query: CatalogQueryInput): Promise<{ meta: Pagination; data: Album[] }> {
        return this.page(query);
    }

    /**
     * An artist with no albums is an empty page rather than a 404: the artist's own endpoint is
     * what says whether the id exists, and the console loads both together.
     */
    async listAlbumsByArtist(artistId: string, query: CatalogQueryInput): Promise<{ meta: Pagination; data: Album[] }> {
        return this.page(query, artistId);
    }

    /** @throws 404 when no such album exists, and equally when it was merged into another. */
    async getAlbum(id: string): Promise<Album> {
        const row = await this.albumsRepository.findAlbum(id);
        if (row === undefined) throw httpError(404).withDetails({ message: `album "${id}" is not in the catalog` });
        return parseAndValidate(withRating(row), Album);
    }

    /**
     * What the station thinks of this record: a dislike here takes every track on it out of
     * rotation, and a like weights them.
     *
     * Re-read rather than echoed, for the reason `ArtistsService.rateArtist` is.
     *
     * @throws 404 when no such album exists, and equally when it was merged into another.
     */
    async rateAlbum(id: string, input: RateInput): Promise<Album> {
        const rated = await this.albumsRepository.setRating(id, ratingToColumn(input.rating));
        if (!rated) throw httpError(404).withDetails({ message: `album "${id}" is not in the catalog` });
        return await this.getAlbum(id);
    }

    private async page(query: CatalogQueryInput, artistId?: string): Promise<{ meta: Pagination; data: Album[] }> {
        const { page, pageSize, sort, search } = query;
        const { total, data } = await this.albumsRepository.listAlbums({ limit: pageSize, offset: page * pageSize, sort, search }, artistId);
        return { meta: { total, page, pageSize, sort }, data: await parseAndValidateArray(data.map(withRating), Album) };
    }
}
