import type { SdkFetch } from '../sdk-options.js';
import { buildQueryString } from '../sdk-options.js';
import type { SpotifyCallbackQuery } from './types/vendors.types.js';

export class VendorsClient {
    constructor(private fetch: SdkFetch) {}

    /** @name Spotify test */
    async spotifyTest(): Promise<void> {
        await this.fetch(`/vendors/spotify/test`, { method: 'GET' });
    }

    /** @name Spotify callback */
    async spotifyCallback(query?: SpotifyCallbackQuery): Promise<void> {
        const qs = buildQueryString(query);
        await this.fetch(`/vendors/spotify/callback${qs}`, {
            method: 'GET',
        });
    }
}
