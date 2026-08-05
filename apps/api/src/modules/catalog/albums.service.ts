import { Injectable } from 'injectkit';
import { AlbumsRepository } from './albums.repository.js';
import { Pagination, PaginationInput } from '../shared/types/pagination.js';
import { Album } from '../music/types/music.types.js';
import { parseAndValidate } from '@maroonedsoftware/zod';

@Injectable()
export class AlbumsService {
    constructor(private readonly albumsRepository: AlbumsRepository) {}

    async listAlbums(query: PaginationInput): Promise<{ meta: Pagination; data: Album[] }> {
        const { page, pageSize, sort } = query;
        const { total, data } = await this.albumsRepository.listAlbums({ limit: pageSize, offset: page * pageSize, sort });
        return { meta: { total, page, pageSize, sort }, data: await Promise.all(data.map((row: unknown) => parseAndValidate(row, Album))) };
    }
}
