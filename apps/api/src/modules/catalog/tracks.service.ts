import { Injectable } from 'injectkit';
import { Pagination, PaginationInput } from '../shared/types/pagination.js';
import { Track } from '../music/types/music.types.js';
import { TracksRepository } from './tracks.repository.js';
import { parseAndValidate } from '@maroonedsoftware/zod';

@Injectable()
export class TracksService {
    constructor(private readonly tracksRepository: TracksRepository) {}

    async listTracks(query: PaginationInput): Promise<{ meta: Pagination; data: Track[] }> {
        const { page, pageSize, sort } = query;
        const { total, data } = await this.tracksRepository.listTracks({ limit: pageSize, offset: page * pageSize, sort });
        return { meta: { total, page, pageSize, sort }, data: await Promise.all(data.map((row: unknown) => parseAndValidate(row, Track))) };
    }
}
