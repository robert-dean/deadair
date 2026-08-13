import { Container } from 'injectkit';
import { ServerKitModule } from '@maroonedsoftware/koa';
import { Logger } from '@maroonedsoftware/logger';
import { RotatingLogStore } from './rotating.log.store.js';
import { errorText } from '#modules/shared/error.text.js';

/**
 * Owns the process-level {@link RotatingLogStore}'s shutdown.
 *
 * The store is process-level infrastructure, not a plugins concern: it backs
 * `FileTeeLogger` for every module's own logging, not just plugin channels.
 * It used to be closed from `PluginsModule.shutdown`, but that made a
 * shutdown-order accident easy — any module registered after `PluginsModule`
 * that logs during its own shutdown would resurrect a stream nothing would
 * ever flush or close. `LoggingModule` has no `setup` of its own: the store
 * is built in `setup.server.ts` (before any container exists) and reached
 * here the same way `PluginsModule` reaches it, via `container.get`.
 *
 * Must be registered last in `modules.ts` so every other module's shutdown
 * logging is flushed before the store closes.
 */
export const LoggingModule: ServerKitModule = {
    name: 'Logging',

    shutdown: async (container: Container) => {
        const logger = container.get(Logger);

        try {
            await container.get(RotatingLogStore).close();
        } catch (error) {
            logger.warn('log store did not close cleanly', { error: errorText(error) });
        }
    },
};
