import type { SdkFetch } from '../sdk-options.js';
import { bigIntReplacer, parseJson } from '../sdk-options.js';
import type { MusicProvider, MusicProviderInput, MusicProviderKey } from './types/settings.types.js';

export class SettingsClient {
    constructor(private fetch: SdkFetch) {}

    /**
     * @name Get Music Providers
     * @description Retrieves the list of supported music providers
     */
    async getMusicProviders(): Promise<MusicProvider[]> {
        const result = await this.fetch(`/settings/music/providers`, { method: 'GET' });
        return await parseJson<MusicProvider[]>(result);
    }

    /** @name Update music provider */
    async updateMusicProvider(key: MusicProviderKey, body: MusicProviderInput): Promise<MusicProvider> {
        const result = await this.fetch(`/settings/music/providers/${encodeURIComponent(key)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body, bigIntReplacer),
        });
        return await parseJson<MusicProvider>(result);
    }
}
