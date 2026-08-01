import { Registry } from 'injectkit';
import { ServerKitModule } from '@maroonedsoftware/koa';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { SpotifyClient } from './spotify/spotify.client.js';
import { SpotifyConfig } from './spotify/spotify.client.js';
import { VendorsService } from './vendors.service.js';

export const VendorsModule: ServerKitModule = {
    name: 'Vendors',
    setup: async (registry: Registry, appConfig: AppConfig) => {
        registry
            .register(SpotifyConfig)
            .useFactory(
                () =>
                    new SpotifyConfig(
                        appConfig.getString('spotify.clientId'),
                        appConfig.getString('spotify.redirectUri'),
                        appConfig.getString('spotify.postbackUri'),
                    ),
            )
            .asSingleton();
        registry.register(SpotifyClient).useClass(SpotifyClient).asSingleton();

        registry.register(VendorsService).useClass(VendorsService).asScoped();
    },
};
