import { Injectable } from 'injectkit';
import { SettingsRepository } from './settings.repository.js';

/**
 * Station settings, backed by the `deadair.settings` key/value table.
 *
 * The music-provider surface that used to live here moved to the plugin
 * system: providers are plugins, their config is the generic plugin config
 * surface, and the active one is named by the `music.provider` setting key.
 */
@Injectable()
export class SettingsService {
    constructor(private readonly settingsRepository: SettingsRepository) {}
}
