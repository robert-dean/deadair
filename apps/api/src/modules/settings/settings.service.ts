import { Injectable } from 'injectkit';
import { AppConfigStore } from '@maroonedsoftware/appconfig';
import { AfterCommit } from '#modules/data/after.commit.js';
import { SettingsRepository } from './settings.repository.js';

/**
 * Station settings, backed by the `deadair.settings` key/value table.
 *
 * Reading one is deliberately not this class's job: the table is a layer of the
 * app's own `AppConfig`, so a setting is read wherever config is, by singletons
 * with no DI scope as well as by request-scoped services. This is the WRITE
 * side, which the config cannot be.
 *
 * The music-provider surface that used to live here moved to the plugin system:
 * providers are plugins, their config is the generic plugin config surface, and
 * the active one is named by the `music.provider` setting key.
 */
@Injectable()
export class SettingsService {
    constructor(
        private readonly settingsRepository: SettingsRepository,
        private readonly configStore: AppConfigStore,
        private readonly afterCommit: AfterCommit,
    ) {}

    /**
     * Write a setting, and have the app's config agree with it before answering.
     *
     * `null` deletes the key, which is how a setting goes back to its default
     * rather than being pinned to an empty string.
     *
     * ## Why the refresh is deferred rather than awaited here
     *
     * The store reloads over its OWN short-lived connection, and a request is one
     * transaction that has not committed yet. Reloading inline would read the row
     * as it stood BEFORE this write and cache that — the failure `AfterCommit` was
     * written for, except quieter, because nothing blocks and nothing throws: the
     * operator's change simply would not take, until some later write happened to
     * reload the store on top of it.
     *
     * The trigger's own `NOTIFY` is correct on its own, because Postgres holds
     * notifications until commit. So this is not what makes the write visible; it
     * is what makes it visible *by the time this request answers* rather than
     * whenever that notification is delivered. `AfterCommit` runs before the
     * response is written, so a console that saves and immediately re-reads sees
     * what it just saved.
     */
    async set(key: string, value: string | null): Promise<void> {
        await this.settingsRepository.set(key, value);
        this.afterCommit.add(async () => {
            await this.configStore.reload();
        });
    }
}
