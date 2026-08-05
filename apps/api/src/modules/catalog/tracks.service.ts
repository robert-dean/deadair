import { Injectable } from 'injectkit';
import { Pagination } from '../shared/types/pagination.js';
import { CatalogQueryInput, Track } from './types/catalog.types.js';
import { TracksRepository } from './tracks.repository.js';
import { parseAndValidateArray } from '@maroonedsoftware/zod';

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

    private async page(query: CatalogQueryInput, albumId?: string): Promise<{ meta: Pagination; data: Track[] }> {
        const { page, pageSize, sort, search } = query;
        const { total, data } = await this.tracksRepository.listTracks({ limit: pageSize, offset: page * pageSize, sort, search }, albumId);
        return { meta: { total, page, pageSize, sort }, data: await parseAndValidateArray(data, Track) };
    }
}
