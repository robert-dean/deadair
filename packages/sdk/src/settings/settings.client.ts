import type { SdkFetch } from '../sdk-options.js';
import { bigIntReplacer, parseJson } from '../sdk-options.js';
import type { StationSettings, StationSettingsInput } from './types/settings.types.js';

export class SettingsClient {
    constructor(private fetch: SdkFetch) {}

    /**
     * @name Get settings
     * @description Every station setting, its descriptor and its current value
     */
    async getSettings(): Promise<StationSettings> {
        const result = await this.fetch(`/settings`, { method: 'GET' });
        return await parseJson<StationSettings>(result);
    }

    /**
     * @name Update settings
     * @description Applies a submitted settings form and answers with the settings as they now stand
     */
    async updateSettings(body: StationSettingsInput): Promise<StationSettings> {
        const result = await this.fetch(`/settings`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body, bigIntReplacer),
        });
        return await parseJson<StationSettings>(result);
    }
}
