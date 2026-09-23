import type { SdkFetch } from '../sdk-options.js';
import { bigIntReplacer, parseJson } from '../sdk-options.js';
import type { SigninProvidersCheck, StationSettings, StationSettingsInput } from './types/settings.types.js';

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

    /**
     * @name Check sign-in providers
     * @description Asks each identity provider in the sign-in settings for its discovery document, the way a sign-in would, and says which answered
     */
    async checkSignInProviders(): Promise<SigninProvidersCheck> {
        const result = await this.fetch(`/settings/signin/check`, { method: 'GET' });
        return await parseJson<SigninProvidersCheck>(result);
    }
}
