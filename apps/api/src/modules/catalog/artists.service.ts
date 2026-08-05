import { Injectable } from 'injectkit';
import { PaginationInput, Pagination } from '../shared/types/pagination.js';
import { Artist } from '../music/types/music.types.js';
import { ArtistsRepository } from './artists.repository.js';
import { parseAndValidate } from '@maroonedsoftware/zod';

@Injectable()
export class ArtistsService {
    constructor(private readonly artistsRepository: ArtistsRepository) {}

    async listArtists(query: PaginationInput): Promise<{ meta: Pagination; data: Artist[] }> {
        const { page, pageSize, sort } = query;
        const { total, data } = await this.artistsRepository.listArtists({ limit: pageSize, offset: page * pageSize, sort });
        return { meta: { total, page, pageSize, sort }, data: await Promise.all(data.map((row: unknown) => parseAndValidate(row, Artist))) };
    }
}
