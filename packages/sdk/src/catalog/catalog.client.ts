import type { SdkFetch } from '../sdk-options.js';
import { bigIntReplacer, parseJson, buildQueryString } from '../sdk-options.js';
import type {
    Album,
    AlbumEnrichmentDetail,
    AlbumPage,
    Artist,
    ArtistEnrichmentDetail,
    ArtistPage,
    CatalogQueryInput,
    ClearEnrichmentQuery,
    RateInput,
    Track,
    TrackClearResult,
    TrackDetail,
    TrackEnrichmentDetail,
    TrackLyrics,
    TrackLyricsSources,
    TrackPage,
    TrackQueryInput,
    VocalMarkersDetail,
    VocalMarkersInput,
} from './types/catalog.types.js';
import {
    reviveAlbumEnrichmentDetail,
    reviveArtistEnrichmentDetail,
    reviveTrackDetail,
    reviveTrackEnrichmentDetail,
    reviveTrackLyricsSources,
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
        return reviveArtistEnrichmentDetail(await parseJson<ArtistEnrichmentDetail>(result));
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
        return reviveAlbumEnrichmentDetail(await parseJson<AlbumEnrichmentDetail>(result));
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
        return reviveTrackDetail(await parseJson<TrackDetail>(result));
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
     * @name Get vocal markers
     * @description Where the singing starts and stops on one record, from an operator's correction or its timed lyrics
     */
    async getVocalMarkers(id: string): Promise<VocalMarkersDetail> {
        const result = await this.fetch(`/catalog/tracks/${encodeURIComponent(id)}/vocal-markers`, { method: 'GET' });
        return await parseJson<VocalMarkersDetail>(result);
    }

    /**
     * @name Set vocal markers
     * @description Correct where the singing starts and stops, over whatever the lyrics say
     */
    async setVocalMarkers(id: string, body: VocalMarkersInput): Promise<VocalMarkersDetail> {
        const result = await this.fetch(`/catalog/tracks/${encodeURIComponent(id)}/vocal-markers`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body, bigIntReplacer),
        });
        return await parseJson<VocalMarkersDetail>(result);
    }

    /**
     * @name Clear vocal markers
     * @description Drop the correction, so the record's timed lyrics decide again
     */
    async clearVocalMarkers(id: string): Promise<VocalMarkersDetail> {
        const result = await this.fetch(`/catalog/tracks/${encodeURIComponent(id)}/vocal-markers`, { method: 'DELETE' });
        return await parseJson<VocalMarkersDetail>(result);
    }

    /**
     * @name Get track lyrics
     * @description The words of one record, from the lyrics source the station believes, with the timing of each line when that source has it
     */
    async getTrackLyrics(id: string): Promise<TrackLyrics> {
        const result = await this.fetch(`/catalog/tracks/${encodeURIComponent(id)}/lyrics`, { method: 'GET' });
        return await parseJson<TrackLyrics>(result);
    }

    /**
     * @name List track lyrics sources
     * @description What every lyrics source answered for one record, in the order the station believes them
     */
    async listTrackLyricsSources(id: string): Promise<TrackLyricsSources> {
        const result = await this.fetch(`/catalog/tracks/${encodeURIComponent(id)}/lyrics/sources`, { method: 'GET' });
        return reviveTrackLyricsSources(await parseJson<TrackLyricsSources>(result));
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
        return reviveTrackEnrichmentDetail(await parseJson<TrackEnrichmentDetail>(result));
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
