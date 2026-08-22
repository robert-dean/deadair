import { Container } from 'injectkit';
import { ServerKitModule } from '@maroonedsoftware/koa';
import { Logger } from '@maroonedsoftware/logger';
import type { RotatingLogStore } from './rotating.log.store.js';
import { getLogStore } from './log.store.js';
import { errorText } from '#modules/shared/error.text.js';

/**
 * Owns the process-level {@link RotatingLogStore}'s shutdown.
 *
 * The store is process-level infrastructure, not a plugins concern: it backs
 * `DeadairLogger` for every module's own logging, not just plugin channels.
 * It used to be closed from `PluginsModule.shutdown`, but that made a
 * shutdown-order accident easy — any module tearing down after `PluginsModule`
 * that logs during its own shutdown would resurrect a stream nothing would
 * ever flush or close. `LoggingModule` has no `setup` of its own: the store
 * is built in `setup.server.ts` before any container exists.
 *
 * It is reached through {@link getLogStore} rather than out of the container,
 * and that is the point rather than a shortcut. The DI token is registered by
 * `PluginsModule`, which sits far LATER in `modules.ts` — so resolving it here
 * meant the module that must tear down last depending on a registration made by
 * one that tears down early. It works only because every setup runs before
 * every shutdown, which is true today and is not a property this module should
 * be resting on. The process-wide holder is the authority either way; the
 * container entry is a convenience for injecting it.
 *
 * Must be registered FIRST in `modules.ts` so every other module's shutdown
 * logging is flushed before the store closes: teardown runs in reverse
 * registration order, so first in the list is last to shut down.
 */
export const LoggingModule: ServerKitModule = {
    name: 'Logging',

    shutdown: async (container: Container) => {
        const logger = container.get(Logger);

        // Absent means the process never got as far as building one, which is a boot that failed
        // before `setup.server.ts` published it. There is nothing to close and nothing wrong.
        const store = getLogStore();
        if (store === undefined) return;

        try {
            await store.close();
        } catch (error) {
            logger.warn('log store did not close cleanly', { error: errorText(error) });
        }
    },
};
