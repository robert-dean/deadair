import type { SdkFetch } from '../sdk-options.js';
import { parseJson, buildQueryString } from '../sdk-options.js';
import type {
    Album,
    AlbumEnrichmentDetail,
    AlbumPage,
    Artist,
    ArtistEnrichmentDetail,
    ArtistPage,
    CatalogQuery,
    CatalogQueryInput,
    TrackEnrichmentDetail,
    TrackPage,
} from './types/catalog.types.js';

export class CatalogClient {
    constructor(private fetch: SdkFetch) {}

    /**
     * @name List artists
     * @description Every artist the station has ingested, ordered by name
     */
    async listArtists(query?: CatalogQueryInput): Promise<ArtistPage> {
        const qs = buildQueryString(query);
        const result = await this.fetch(`/catalog/artists${qs}`, {
            method: 'GET',
        });
        return await parseJson<ArtistPage>(result);
    }

    /**
     * @name Get artist
     * @description One artist. 404s on an id that was merged away, since reads never return merged rows
     */
    async getArtist(id: string): Promise<Artist> {
        const result = await this.fetch(`/catalog/artists/${encodeURIComponent(id)}`, { method: 'GET' });
        return await parseJson<Artist>(result);
    }

    /**
     * @name Get artist enrichment
     * @description What every enrichment provider said about this artist, and when each of them said it
     */
    async getArtistEnrichment(id: string): Promise<ArtistEnrichmentDetail> {
        const result = await this.fetch(`/catalog/artists/${encodeURIComponent(id)}/enrichment`, { method: 'GET' });
        return await parseJson<ArtistEnrichmentDetail>(result);
    }

    /**
     * @name List artist albums
     * @description The albums credited to one artist
     */
    async listArtistAlbums(id: string, query?: CatalogQueryInput): Promise<AlbumPage> {
        const qs = buildQueryString(query);
        const result = await this.fetch(`/catalog/artists/${encodeURIComponent(id)}/albums${qs}`, {
            method: 'GET',
        });
        return await parseJson<AlbumPage>(result);
    }

    /** @name List albums */
    async listAlbums(query?: CatalogQueryInput): Promise<AlbumPage> {
        const qs = buildQueryString(query);
        const result = await this.fetch(`/catalog/albums${qs}`, {
            method: 'GET',
        });
        return await parseJson<AlbumPage>(result);
    }

    /** @name Get album */
    async getAlbum(id: string): Promise<Album> {
        const result = await this.fetch(`/catalog/albums/${encodeURIComponent(id)}`, { method: 'GET' });
        return await parseJson<Album>(result);
    }

    /**
     * @name Get album enrichment
     * @description The record's own enrichment: the label, pressing and cover belong to the release, not to a track on it
     */
    async getAlbumEnrichment(id: string): Promise<AlbumEnrichmentDetail> {
        const result = await this.fetch(`/catalog/albums/${encodeURIComponent(id)}/enrichment`, { method: 'GET' });
        return await parseJson<AlbumEnrichmentDetail>(result);
    }

    /**
     * @name List album tracks
     * @description One album's tracks
     */
    async listAlbumTracks(id: string, query?: CatalogQueryInput): Promise<TrackPage> {
        const qs = buildQueryString(query);
        const result = await this.fetch(`/catalog/albums/${encodeURIComponent(id)}/tracks${qs}`, {
            method: 'GET',
        });
        return await parseJson<TrackPage>(result);
    }

    /**
     * @name Get track enrichment
     * @description What the providers said about one recording, including everything no canonical column holds
     */
    async getTrackEnrichment(id: string): Promise<TrackEnrichmentDetail> {
        const result = await this.fetch(`/catalog/tracks/${encodeURIComponent(id)}/enrichment`, { method: 'GET' });
        return await parseJson<TrackEnrichmentDetail>(result);
    }

    /**
     * @name List tracks
     * @description Every track, flat. The only way to answer "do we have this song?" without knowing its artist
     */
    async listTracks(query?: CatalogQueryInput): Promise<TrackPage> {
        const qs = buildQueryString(query);
        const result = await this.fetch(`/catalog/tracks${qs}`, {
            method: 'GET',
        });
        return await parseJson<TrackPage>(result);
    }
}
