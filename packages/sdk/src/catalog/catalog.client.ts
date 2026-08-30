import type { SdkFetch } from '../sdk-options.js';
import { bigIntReplacer, parseJson, buildQueryString } from '../sdk-options.js';
import type {
    Album,
    AlbumEnrichmentDetail,
    AlbumPage,
    Artist,
    ArtistEnrichmentDetail,
    ArtistPage,
    CatalogQuery,
    CatalogQueryInput,
    ClearEnrichmentQuery,
    RateInput,
    Track,
    TrackClearResult,
    TrackDetail,
    TrackEnrichmentDetail,
    TrackPage,
    TrackQuery,
    TrackQueryInput,
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

    /**
     * @name Rate artist
     * @description What the station thinks of this artist. A dislike here excludes every record they are credited on
     */
    async rateArtist(id: string, body: RateInput): Promise<Artist> {
        const result = await this.fetch(`/catalog/artists/${encodeURIComponent(id)}/rating`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body, bigIntReplacer),
        });
        return await parseJson<Artist>(result);
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
    async listAlbumTracks(id: string, query?: TrackQueryInput): Promise<TrackPage> {
        const qs = buildQueryString(query);
        const result = await this.fetch(`/catalog/albums/${encodeURIComponent(id)}/tracks${qs}`, {
            method: 'GET',
        });
        return await parseJson<TrackPage>(result);
    }

    /**
     * @name Rate album
     * @description What the station thinks of this record. A dislike here excludes every track on it
     */
    async rateAlbum(id: string, body: RateInput): Promise<Album> {
        const result = await this.fetch(`/catalog/albums/${encodeURIComponent(id)}/rating`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body, bigIntReplacer),
        });
        return await parseJson<Album>(result);
    }

    /**
     * @name Get track
     * @description One record and everything it has accumulated: its copies, its bytes, its measurement, what it has aired
     */
    async getTrack(id: string): Promise<TrackDetail> {
        const result = await this.fetch(`/catalog/tracks/${encodeURIComponent(id)}`, { method: 'GET' });
        return await parseJson<TrackDetail>(result);
    }

    /**
     * @name Clear track audio
     * @description Drop the station's own copies of this record. The next play fetches them again
     */
    async clearTrackAudio(id: string): Promise<TrackClearResult> {
        const result = await this.fetch(`/catalog/tracks/${encodeURIComponent(id)}/audio`, { method: 'DELETE' });
        return await parseJson<TrackClearResult>(result);
    }

    /**
     * @name Clear track analysis
     * @description Forget the measurement, so the walk takes it again
     */
    async clearTrackAnalysis(id: string): Promise<TrackClearResult> {
        const result = await this.fetch(`/catalog/tracks/${encodeURIComponent(id)}/analysis`, { method: 'DELETE' });
        return await parseJson<TrackClearResult>(result);
    }

    /**
     * @name Retry track audio
     * @description Try this record's copies again now, rather than when the backoff says
     */
    async retryTrackAudio(id: string): Promise<TrackClearResult> {
        const result = await this.fetch(`/catalog/tracks/${encodeURIComponent(id)}/retry`, { method: 'POST' });
        return await parseJson<TrackClearResult>(result);
    }

    /**
     * @name Offer track copies again
     * @description Put copies a provider refused back on offer, and clear their backoff so they are tried now
     */
    async offerTrackCopiesAgain(id: string): Promise<TrackClearResult> {
        const result = await this.fetch(`/catalog/tracks/${encodeURIComponent(id)}/offer`, { method: 'POST' });
        return await parseJson<TrackClearResult>(result);
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
     * @name Clear track enrichment
     * @description Forget what the providers said, so the enrichment pass asks again
     */
    async clearTrackEnrichment(id: string, query?: ClearEnrichmentQuery): Promise<TrackClearResult> {
        const qs = buildQueryString(query);
        const result = await this.fetch(`/catalog/tracks/${encodeURIComponent(id)}/enrichment${qs}`, {
            method: 'DELETE',
        });
        return await parseJson<TrackClearResult>(result);
    }

    /**
     * @name List tracks
     * @description Every track, flat. The only way to answer "do we have this song?" without knowing its artist
     */
    async listTracks(query?: TrackQueryInput): Promise<TrackPage> {
        const qs = buildQueryString(query);
        const result = await this.fetch(`/catalog/tracks${qs}`, {
            method: 'GET',
        });
        return await parseJson<TrackPage>(result);
    }

    /**
     * @name Rate track
     * @description What the station thinks of this song, which is the narrowest thing an opinion can be about
     */
    async rateTrack(id: string, body: RateInput): Promise<Track> {
        const result = await this.fetch(`/catalog/tracks/${encodeURIComponent(id)}/rating`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body, bigIntReplacer),
        });
        return await parseJson<Track>(result);
    }
}
