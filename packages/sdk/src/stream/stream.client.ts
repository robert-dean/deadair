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
