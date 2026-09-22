import type { SdkFetch } from '../sdk-options.js';
import { bigIntReplacer, parseJson } from '../sdk-options.js';
import type {
    FetcherAuthorization,
    FetcherAuthorizationFinished,
    FetcherAuthorizationInput,
    FetcherAuthorizationStart,
} from './types/stream.types.js';

export class StreamClient {
    constructor(private fetch: SdkFetch) {}

    /**
     * @name Get HLS playlist
     * @description One HLS playlist, and the tick that says somebody is still listening to it
     */
    async getHLSPlaylist(name: string): Promise<{ data: Blob; headers: { cacheControl?: string } }> {
        const result = await this.fetch(`/hls/${encodeURIComponent(name)}`, { method: 'GET' });
        const data = await result.blob();
        return { data, headers: { cacheControl: result.headers.get('cache-control') ?? undefined } };
    }

    /**
     * @name Get tune-in pls
     * @description The station's streams as a PLS playlist, MP3 first, for a player that takes a playlist file rather than a stream address
     */
    async getTuneInPls(): Promise<Blob> {
        const result = await this.fetch(`/listen.pls`, { method: 'GET' });
        return await result.blob();
    }

    /**
     * @name Get tune-in m3u
     * @description The station's streams as an M3U playlist, MP3 first, for a player that takes a playlist file rather than a stream address
     */
    async getTuneInM3u(): Promise<Blob> {
        const result = await this.fetch(`/listen.m3u`, { method: 'GET' });
        return await result.blob();
    }

    /**
     * @name Read fetcher authorization
     * @description What the track fetcher holds by way of a Spotify login, and whether an authorization is already waiting to be finished
     */
    async readFetcherAuthorization(): Promise<FetcherAuthorization> {
        const result = await this.fetch(`/stream/authorization`, { method: 'GET' });
        return await parseJson<FetcherAuthorization>(result);
    }

    /**
     * @name Start fetcher authorization
     * @description Starts the fetcher's one-time authorization and answers with the URL to open. Starting another replaces whichever was pending
     */
    async startFetcherAuthorization(): Promise<FetcherAuthorizationStart> {
        const result = await this.fetch(`/stream/authorization`, { method: 'POST' });
        return await parseJson<FetcherAuthorizationStart>(result);
    }

    /**
     * @name Finish fetcher authorization
     * @description Finishes an authorization from the address the operator's browser ended up at
     */
    async finishFetcherAuthorization(body: FetcherAuthorizationInput): Promise<FetcherAuthorizationFinished> {
        const result = await this.fetch(`/stream/authorization/complete`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body, bigIntReplacer),
        });
        return await parseJson<FetcherAuthorizationFinished>(result);
    }
}
