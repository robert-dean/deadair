import { Injectable } from 'injectkit';
import { Pagination } from '../shared/types/pagination.js';
import { httpError } from '@maroonedsoftware/errors';
import { CatalogQueryInput, RateInput, Track } from './types/catalog.types.js';
import { TracksRepository } from './tracks.repository.js';
import { ratingToColumn, withRating } from './rating.js';
import { parseAndValidate, parseAndValidateArray } from '@maroonedsoftware/zod';

@Injectable()
export class TracksService {
    constructor(private readonly tracksRepository: TracksRepository) {}

    async listTracks(query: CatalogQueryInput): Promise<{ meta: Pagination; data: Track[] }> {
        return this.page(query);
    }

    /** An album with no tracks is an empty page; the album's own endpoint is what says whether the id exists. */
    async listTracksByAlbum(albumId: string, query: CatalogQueryInput): Promise<{ meta: Pagination; data: Track[] }> {
        return this.page(query, albumId);
    }

    /**
     * What the station thinks of this song, which is the narrowest an opinion can be: it says
     * nothing about the record it is on or the artist who made it.
     *
     * Re-read rather than echoed, for the reason `ArtistsService.rateArtist` is.
     *
     * @throws 404 when no such track exists, and equally when it was merged into another.
     */
    async rateTrack(id: string, input: RateInput): Promise<Track> {
        const rated = await this.tracksRepository.setRating(id, ratingToColumn(input.rating));
        if (!rated) throw httpError(404).withDetails({ message: `track "${id}" is not in the catalog` });

        // Unreachable in practice: the update just matched a row this same request is about to read
        // back, on a table nothing else deletes from.
        const row = await this.tracksRepository.findTrack(id);
        if (row === undefined) throw httpError(404).withDetails({ message: `track "${id}" is not in the catalog` });
        return parseAndValidate(withRating(row), Track);
    }

    private async page(query: CatalogQueryInput, albumId?: string): Promise<{ meta: Pagination; data: Track[] }> {
        const { page, pageSize, sort, search } = query;
        const { total, data } = await this.tracksRepository.listTracks({ limit: pageSize, offset: page * pageSize, sort, search }, albumId);
        return { meta: { total, page, pageSize, sort }, data: await parseAndValidateArray(data.map(withRating), Track) };
    }
}
