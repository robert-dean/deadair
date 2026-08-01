import { Injectable } from 'injectkit';
import { SpotifyApi } from '@spotify/web-api-ts-sdk';

@Injectable()
export class SpotifyConfig {
    constructor(
        readonly clientId: string,
        readonly redirectUri: string,
        readonly postbackUri: string,
    ) {}
}

const SPOTIFY_SCOPES: string[] = [
    // Catalog / profile — the rotation pool
    'user-read-private',
    'user-read-email',
    'user-library-read',
    'playlist-read-private',
    'playlist-read-collaborative',
    'user-top-read',
    // The shim's session, plus the settings card's playback preview
    'streaming',
    'user-read-playback-state',
    'user-modify-playback-state',
    'user-read-currently-playing',
] as const;

@Injectable()
export class SpotifyClient {
    private readonly api: SpotifyApi;

    constructor(private readonly config: SpotifyConfig) {
        this.api = SpotifyApi.withUserAuthorization(this.config.clientId, this.config.redirectUri, SPOTIFY_SCOPES);
    }

    private async getClient() {
        if (!(await this.api.getAccessToken())) {
            await this.api.authenticate();
        }
        return this.api;
    }

    async getUserProfile() {
        const client = await this.getClient();
        return client.currentUser.profile();
    }
}
