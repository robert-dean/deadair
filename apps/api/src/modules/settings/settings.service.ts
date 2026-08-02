import { Injectable } from 'injectkit';
import { SettingsRepository } from './settings.repository.js';
import { MusicProvider, MusicProviderInput, MusicProviderKey } from './types/settings.types.js';

@Injectable()
export class SettingsService {
    constructor(private readonly settingsRepository: SettingsRepository) {}

    async getMusicProviders(): Promise<MusicProvider[]> {
        return [];
    }

    async updateMusicProvider(key: MusicProviderKey, provider: MusicProviderInput): Promise<MusicProvider> {
        return {} as MusicProvider;
    }
}
