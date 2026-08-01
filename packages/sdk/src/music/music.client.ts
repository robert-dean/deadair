import type { SdkFetch } from '../sdk-options.js';
import { parseJson, buildQueryString } from '../sdk-options.js';
import type { Pagination, PaginationInput } from '../shared/types/pagination.js';
import type { Album, Artist, Track } from './types/music.types.js';

export class MusicClient {
    constructor(private fetch: SdkFetch) {}

    /** @name List artists */
    async listArtists(query?: PaginationInput): Promise<{ meta: Pagination; data: Artist[] }> {
        const qs = buildQueryString(query);
        const result = await this.fetch(`/music/artists${qs}`, {
            method: 'GET',
        });
        return await parseJson<{ meta: Pagination; data: Artist[] }>(result);
    }

    /** @name List albums */
    async listAlbums(query?: PaginationInput): Promise<{ meta: Pagination; data: Album[] }> {
        const qs = buildQueryString(query);
        const result = await this.fetch(`/music/albums${qs}`, {
            method: 'GET',
        });
        return await parseJson<{ meta: Pagination; data: Album[] }>(result);
    }

    /** @name List tracks */
    async listTracks(query?: PaginationInput): Promise<{ meta: Pagination; data: Track[] }> {
        const qs = buildQueryString(query);
        const result = await this.fetch(`/music/tracks${qs}`, {
            method: 'GET',
        });
        return await parseJson<{ meta: Pagination; data: Track[] }>(result);
    }
}
