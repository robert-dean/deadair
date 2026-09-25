import { Registry } from 'injectkit';
import { ServerKitModule } from '@maroonedsoftware/koa';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { ConsoleLanguageRepository } from './console.language.repository.js';
import { ConsoleLanguagesService } from './console.languages.service.js';

/**
 * The languages the console can be shown in beyond its built-in English: the language packs an admin
 * imported, stored for every operator's console to load.
 *
 * It starts nothing and owns no loop. A pack is written because an admin imported it and read
 * because a console is about to draw a page, which is why its position in the list is a question of
 * nothing but what it resolves: the database and the station's identity, both registered long
 * before it.
 */
export const LanguagesModule: ServerKitModule = {
    name: 'Languages',
    setup: async (registry: Registry, _: AppConfig) => {
        // Scoped like every other repository: per request on the request path.
        registry.register(ConsoleLanguageRepository).useClass(ConsoleLanguageRepository).asScoped();
        registry.register(ConsoleLanguagesService).useClass(ConsoleLanguagesService).asScoped();
    },
};
