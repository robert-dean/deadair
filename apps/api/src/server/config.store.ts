import type { AppConfigStore } from '@maroonedsoftware/appconfig';

/**
 * Process-wide holder for the one {@link AppConfigStore} instance.
 *
 * The same arrangement as `log.store.ts`, and for the same reason: the store is
 * built in `setup.server.ts` before any DI container exists (the container is
 * handed the config the store produces), while `SettingsModule` needs that same
 * instance to register it for injection, to reload it after a write, and to
 * dispose its `LISTEN` connection at shutdown.
 *
 * Exactly one instance matters here more than it looks. A second store would
 * open a second listener on `deadair_settings_changed` and hold a second
 * snapshot of the settings table, so a write would refresh one of them and the
 * config every consumer is actually reading would be the other.
 */
let store: AppConfigStore | undefined;

/** Records the process-wide store built during server setup. */
export function setConfigStore(next: AppConfigStore): void {
    store = next;
}

/** The store built during server setup, or undefined if setup has not run (tests). */
export function getConfigStore(): AppConfigStore | undefined {
    return store;
}
