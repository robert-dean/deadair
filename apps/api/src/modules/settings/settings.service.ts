import { Injectable } from 'injectkit';
import { AppConfig, AppConfigStore } from '@maroonedsoftware/appconfig';
import { EncryptionProvider } from '@maroonedsoftware/encryption';
import { httpError } from '@maroonedsoftware/errors';
import { AfterCommit } from '#modules/data/after.commit.js';
import { StreamService } from '#modules/stream/stream.service.js';
import { isStreamSettingKey } from '#modules/stream/stream.settings.js';
import { SettingsRepository } from './settings.repository.js';
import { parseSetting, serializeSetting, type SettingRejection, type SettingValue } from './setting.values.js';
import { findDescriptor, isSecretField, isValueField, SETTING_DESCRIPTORS } from './settings.registry.js';
import type { StationSettings, StationSettingsInput } from './types/settings.types.js';

/**
 * Station settings, backed by the `deadair.settings` key/value table.
 *
 * Reading one is deliberately not this class's job: the table is a layer of the
 * app's own `AppConfig`, so a setting is read wherever config is, by singletons
 * with no DI scope as well as by request-scoped services. This is the WRITE
 * side, which the config cannot be.
 *
 * The music-provider surface that used to live here moved to the plugin system:
 * providers are plugins and their config is the generic plugin config surface.
 * There is no setting naming an active provider — the catalog syncs from every
 * enabled one, and where a capability genuinely has to pick a single plugin the
 * key is capability-scoped (`render.speechPluginId`, `llm.pluginId`,
 * `analysis.pluginId`) and resolved by `selectPlugin`.
 */
@Injectable()
export class SettingsService {
    constructor(
        private readonly settingsRepository: SettingsRepository,
        private readonly configStore: AppConfigStore,
        private readonly config: AppConfig,
        private readonly encryption: EncryptionProvider,
        // Injected for one reason: a `stream.*` write has to be rendered out to the containers,
        // which cannot read the database. Nothing here reads the stream's settings.
        private readonly stream: StreamService,
        private readonly afterCommit: AfterCommit,
    ) {}

    /**
     * Every declared setting, with what it is currently worth.
     *
     * Read through the config rather than the table, so what the console shows is
     * what the station is actually running on rather than a second reading of the
     * same rows that could differ from it.
     */
    read(): StationSettings {
        const values: Record<string, SettingValue> = {};
        const configured: Record<string, boolean> = {};

        for (const descriptor of SETTING_DESCRIPTORS) {
            if (!isValueField(descriptor)) continue;

            if (isSecretField(descriptor)) {
                // Whether one is stored, never what it is — not even its ciphertext. A `secret` is
                // write-only by the descriptor's own definition, and this is where that holds.
                configured[descriptor.key] = this.config.has(descriptor.key) && this.config.get(descriptor.key, '') !== '';
                continue;
            }

            const stored = this.config.has(descriptor.key) ? this.config.get(descriptor.key, '') : undefined;
            values[descriptor.key] = parseSetting(descriptor, stored);
        }

        return { descriptors: [...SETTING_DESCRIPTORS], values, configured };
    }

    /**
     * Apply a submitted settings form.
     *
     * Partial by design, matching `PluginConfigService.saveConfig`: a key that is
     * present is written, a key that is absent is left exactly as it was. So a
     * console can send one field, and a form that never renders the secrets cannot
     * clear them by omission.
     *
     * A `secret` submitted blank is CLEARED rather than stored as an empty string,
     * which is how an operator removes one. A non-secret submitted blank is stored
     * as empty, because for several of these — an advertised hostname, a public URL
     * — empty is a meaningful answer that means "work it out".
     *
     * A key nobody declared is refused rather than ignored. The alternative is a
     * typo in a console silently writing a row nothing will ever read, which looks
     * exactly like a setting that does not work.
     *
     * @throws 422 listing every value it refused, rather than the first: somebody
     * correcting a form should see all of it at once. Nothing is written when
     * anything is refused, so a rejected submission leaves the station as it was.
     */
    async write(submitted: Record<string, unknown>): Promise<StationSettings> {
        const rejections: SettingRejection[] = [];
        const writes: { key: string; value: string | null }[] = [];

        for (const [key, submittedValue] of Object.entries(submitted)) {
            const descriptor = findDescriptor(key);
            if (descriptor === undefined || !isValueField(descriptor)) {
                rejections.push({ key, message: `"${key}" is not a station setting` });
                continue;
            }

            if (isSecretField(descriptor)) {
                const raw = typeof submittedValue === 'string' ? submittedValue.trim() : '';
                writes.push({ key, value: raw === '' ? null : this.encryption.encrypt(raw) });
                continue;
            }

            // An explicit `null` deletes the row, which puts the setting back to the station's
            // default rather than pinning it to an empty string or a zero. That is the only way an
            // operator can UNDO a change to something like the break spacing: without it, a number
            // field they cleared would be refused as "takes a number", and the default would be
            // reachable only by remembering what it used to be and typing it back in.
            if (submittedValue === null) {
                writes.push({ key, value: null });
                continue;
            }

            const result = serializeSetting(descriptor, submittedValue);
            if ('rejected' in result) rejections.push(result.rejected);
            else writes.push({ key, value: result.value });
        }

        if (rejections.length > 0) {
            throw httpError(422).withDetails({ message: rejections.map(rejection => rejection.message).join('; '), rejections });
        }

        for (const write of writes) {
            await this.settingsRepository.set(write.key, write.value);
        }
        this.scheduleRefresh();

        // A `stream.*` change is not in force until it has been written out as files: Icecast and
        // Liquidsoap cannot read the database. Queued AFTER the refresh and never instead of it,
        // because the renderer reads these settings through the same config — materializing first
        // would write the values as they stood before this request.
        //
        // It does NOT restart either container, so what this buys is that the next restart adopts
        // the change rather than the operator having to remember to re-render. See
        // [mixer-settings-in-db](https://github.com/robert-dean/deadair/discussions/20) for why the restart is its own piece of work.
        if (writes.some(write => isStreamSettingKey(write.key))) {
            this.afterCommit.add(async () => {
                await this.stream.materialize();
            });
        }

        // Built from the values just written rather than re-read, for the reason `set` explains:
        // the config does not refresh until this request commits, so reading it back here would
        // answer with what the operator has just replaced.
        return this.readAsWritten(writes);
    }

    /**
     * {@link write}, taking the request body the route hands over.
     *
     * Its own method rather than reshaping `write`, because the envelope is the
     * contract's and the map is the domain's: everything that is not a route —
     * the tests, and anything that grows into a second caller — has a map and
     * would otherwise have to wrap it in a `values` key to talk to its own
     * service.
     */
    async writeSubmitted(input: StationSettingsInput): Promise<StationSettings> {
        return await this.write(input.values);
    }

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
        this.scheduleRefresh();
    }

    /** Rebuild the app's config once this request's transaction has committed. See {@link set}. */
    private scheduleRefresh(): void {
        this.afterCommit.add(async () => {
            await this.configStore.reload();
        });
    }

    /**
     * The read model as it will be once the writes above are visible.
     *
     * The current config with this request's own writes laid over it, rather than
     * either one alone: the config has everything that was NOT submitted, and the
     * writes have what was.
     */
    private readAsWritten(writes: readonly { key: string; value: string | null }[]): StationSettings {
        const model = this.read();

        for (const write of writes) {
            const descriptor = findDescriptor(write.key);
            if (descriptor === undefined) continue;

            if (isSecretField(descriptor)) model.configured[write.key] = write.value !== null;
            else model.values[write.key] = parseSetting(descriptor, write.value ?? undefined);
        }

        return model;
    }
}
