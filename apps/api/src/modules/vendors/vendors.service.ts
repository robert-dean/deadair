import { Injectable } from 'injectkit';
import { SpotifyCallbackQuery } from './types/vendors.types.js';
import { Logger } from '@maroonedsoftware/logger';
import { SpotifyClient } from './spotify/spotify.client.js';

@Injectable()
export class VendorsService {
    constructor(
        private readonly logger: Logger,
        private readonly spotifyClient: SpotifyClient,
    ) {}

    async spotifyTest() {
        return await this.spotifyClient.getUserProfile();
    }

    async spotifyCallback(query: SpotifyCallbackQuery) {
        const outcome = 'connected';

        this.logger.info('Spotify callback', { query });
        // if (query.error || !query.code || !query.state) {
        //     outcome = 'error';
        // } else {
        //     try {
        //     } catch {
        //         outcome = 'error';
        //     }
        // }
    }
}
