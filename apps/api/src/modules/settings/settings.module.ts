import { Registry } from 'injectkit';
import { ServerKitModule } from '@maroonedsoftware/koa';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { SettingsService } from './settings.service.js';
import { SettingsRepository } from './settings.repository.js';

export const SettingsModule: ServerKitModule = {
    name: 'Settings',
    setup: async (registry: Registry, _: AppConfig) => {
        registry.register(SettingsService).useClass(SettingsService).asScoped();
        registry.register(SettingsRepository).useClass(SettingsRepository).asScoped();
    },
};
