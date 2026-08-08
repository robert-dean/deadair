import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Injectable } from 'injectkit';
import type { DeadairPlugin, PluginFactory, PluginInstance, PluginManifest } from '@deadair/plugin-sdk';
import { PluginConfigRepository, type PluginConfigRecord } from './plugin.config.repository.js';
import { PluginConfigService } from './plugin.config.service.js';
import { PLUGIN_OAUTH_SECRET_KEY, PluginHostFactory } from './plugin.host.factory.js';
import { PluginInvoker } from './plugin.invoker.js';
import { PluginLoader } from './plugin.loader.js';
import { PluginLog } from './plugin.log.js';
import { PluginRegistry, firstWinsById } from './plugin.registry.js';
import type { PluginRecord, PluginStatus } from './types/plugin.record.js';
import { PluginLogLevel } from './types/plugins.types.js';

const errorText = (error: unknown): string => {
    if (!(error instanceof Error)) return String(error);
    const details = (error as { details?: Record<string, unknown> }).details;
    const detail = details?.message;
    return typeof detail === 'string' && detail.length > 0 ? detail : error.message;
};

/** Narrows a stored `log_level` column (free text) to a legal level, or `undefined` for anything else. */
const toPluginLogLevel = (value: string | undefined): PluginLogLevel | undefined => {
    const parsed = PluginLogLevel.safeParse(value);
    return parsed.success ? parsed.data : undefined;
};

/**
 * Owns the runtime state of every plugin: what exists, what is enabled, what is
 * running, and what went wrong.
 *
 * Nothing here is allowed to throw at its callers. Boot calls
 * {@link PluginLifecycleManager.discoverAll} and
 * {@link PluginLifecycleManager.initAllEnabled}, and a broken plugin (or a
 * broken database read) must degrade to a recorded status rather than take the
 * server down with it, so every failure path ends in a log line plus a status.
 *
 * Work for a single plugin is serialized through a per-plugin queue: a config
 * change arriving while that plugin is still initializing must not run a second
 * factory against the same record and leak the first instance.
 */
@Injectable()
export class PluginLifecycleManager {
    /** Serializes lifecycle work per plugin id. */
    private readonly queues = new Map<string, Promise<void>>();

    constructor(
        private readonly pluginLoader: PluginLoader,
        private readonly pluginRegistry: PluginRegistry,
        private readonly pluginHostFactory: PluginHostFactory,
        private readonly pluginInvoker: PluginInvoker,
        private readonly pluginConfigService: PluginConfigService,
        private readonly pluginConfigRepository: PluginConfigRepository,
        private readonly pluginLog: PluginLog,
    ) {}

    /**
     * Scans the disk, replaces the registry contents, and folds the stored
     * enabled flag over each record. Instantiates nothing: that is
     * {@link PluginLifecycleManager.initAllEnabled}, which runs off the boot path.
     */
    async discoverAll(): Promise<void> {
        let records: PluginRecord[] = [];
        try {
            records = await this.pluginLoader.discover();
        } catch (error) {
            // The loader is written not to throw, so this is belt and braces:
            // discovery failing wholesale must still leave a bootable server.
            this.pluginLog.error('plugin discovery failed', { error: errorText(error) });
        }

        this.pluginRegistry.setAll(records);
        await this.applyStoredState();

        const failed = records.filter(record => record.status === 'failed');
        this.pluginLog.info('plugin discovery complete', { discovered: records.length, quarantined: failed.length });
        for (const record of failed) {
            this.pluginLog.for(record.id).warn('plugin quarantined at discovery', { dir: record.dir, error: record.error });
        }
    }

    /**
     * Rediscovers without disturbing what is already running: new directories
     * are registered, newly broken ones are quarantined, and records whose
     * directory has disappeared are disposed and dropped.
     */
    async rescan(): Promise<void> {
        let records: PluginRecord[];
        try {
            records = await this.pluginLoader.discover();
        } catch (error) {
            this.pluginLog.error('plugin rescan failed', { error: errorText(error) });
            return;
        }

        // Same first-wins rule discovery and `setAll` use. Without it a second
        // copy of an installed plugin (a symlinked dev checkout, say) comes back
        // quarantined as a duplicate id and would be upserted over the copy that
        // won the id, orphaning its live instance.
        const found = firstWinsById(records);

        for (const existing of this.pluginRegistry.list()) {
            if (found.has(existing.id)) continue;
            this.pluginLog.for(existing.id).info('plugin disappeared; unloading', { dir: existing.dir });
            await this.disposePlugin(existing.id);
            this.pluginRegistry.remove(existing.id);
        }

        for (const record of found.values()) {
            const existing = this.pluginRegistry.get(record.id);
            // A running plugin keeps its instance: re-registering the record
            // would orphan it with no way left to call dispose.
            if (existing?.status === 'active' && existing.dir === record.dir) continue;
            this.pluginRegistry.upsert(record);
        }

        await this.applyStoredState();
    }

    /** Initializes every enabled plugin. Never rejects: per-plugin failures are recorded. */
    async initAllEnabled(): Promise<void> {
        const configs = await this.listConfigs();
        const enabled = this.pluginRegistry.list().filter(record => record.manifest !== undefined && configs.get(record.id)?.enabled === true);

        this.pluginLog.info('initializing enabled plugins', { count: enabled.length });
        await Promise.all(enabled.map(record => this.initPlugin(record.id)));
    }

    /**
     * Builds a host, runs the plugin's factory and `init`, and records the
     * outcome as a status. Skips anything that is not enabled, and refuses
     * anything whose stored config no longer satisfies its manifest schema.
     */
    async initPlugin(pluginId: string): Promise<void> {
        return this.enqueue(pluginId, () => this.initNow(pluginId));
    }

    /** Tears a plugin's instance down. Safe to call on a plugin that is not running. */
    async disposePlugin(pluginId: string): Promise<void> {
        return this.enqueue(pluginId, () => this.disposeNow(pluginId));
    }

    /**
     * Dispose then init, as one unit of queued work. This is what a config
     * change (the settings PUT, an enable/disable, an explicit reload) applies.
     */
    async reinitPlugin(pluginId: string): Promise<void> {
        return this.enqueue(pluginId, async () => {
            await this.disposeNow(pluginId);
            await this.initNow(pluginId);
        });
    }

    /** Tears down every running instance. Used on shutdown. */
    async disposeAll(): Promise<void> {
        const running = this.pluginRegistry.list().filter(record => record.instance !== undefined);
        if (running.length === 0) return;

        this.pluginLog.info('disposing plugins', { count: running.length });
        await Promise.all(running.map(record => this.disposePlugin(record.id)));
    }

    /**
     * Folds the stored enabled flag over the in-memory records. `active` and
     * `failed` are left alone: a running plugin's status is authoritative, and a
     * quarantined one has already been judged on evidence the database has not
     * got.
     */
    private async applyStoredState(): Promise<void> {
        const configs = await this.listConfigs();

        // Pushed for every row, including one whose status the loop below
        // leaves untouched: an already-active plugin still has to pick up a
        // level change made while it was running.
        for (const [pluginId, config] of configs) {
            this.pluginLog.setLevel(pluginId, toPluginLogLevel(config.logLevel));
        }

        for (const record of this.pluginRegistry.list()) {
            if (record.status === 'active' || record.status === 'failed') continue;
            const config = configs.get(record.id);
            if (!config) {
                this.pluginRegistry.setStatus(record.id, 'discovered');
                continue;
            }
            this.pluginRegistry.setStatus(record.id, config.enabled ? 'discovered' : 'disabled');
        }
    }

    /** Stored config rows by plugin id. An unreachable database yields an empty map. */
    private async listConfigs(): Promise<Map<string, PluginConfigRecord>> {
        try {
            const rows = await this.pluginConfigRepository.list();
            return new Map(rows.map(row => [row.pluginId, row]));
        } catch (error) {
            this.pluginLog.error('could not read plugin configuration', { error: errorText(error) });
            return new Map();
        }
    }

    private async initNow(pluginId: string): Promise<void> {
        const record = this.pluginRegistry.get(pluginId);
        if (!record) {
            this.pluginLog.for(pluginId).warn('init requested for an unknown plugin');
            return;
        }
        // No manifest means the loader quarantined it; nothing about it is
        // trustworthy enough to instantiate.
        if (!record.manifest) return;

        // An init arriving over a live instance (a reinit that skipped dispose,
        // a duplicate notification) would strand the old one uncloseable.
        if (record.instance) await this.disposeNow(pluginId);

        let config: PluginConfigRecord | undefined;
        try {
            config = await this.pluginConfigRepository.get(pluginId);
        } catch (error) {
            this.pluginLog.for(pluginId).error('could not read plugin configuration', { error: errorText(error) });
            return;
        }

        this.pluginLog.setLevel(pluginId, toPluginLogLevel(config?.logLevel));

        if (!config?.enabled) {
            this.pluginRegistry.setStatus(pluginId, config ? 'disabled' : 'discovered');
            return;
        }

        const invalid = await this.validateConfig(record.manifest, config);
        if (invalid !== undefined) {
            await this.setStatus(pluginId, 'misconfigured', invalid);
            this.pluginLog.for(pluginId).warn('plugin is misconfigured', { error: invalid });
            return;
        }

        // A fresh configuration deserves a fresh breaker: fixing the settings is
        // how an operator un-quarantines a plugin that was failing.
        this.pluginInvoker.reset(pluginId);
        const host = this.pluginHostFactory.createHost(record.manifest);

        try {
            const instance = await this.pluginInvoker.invoke(pluginId, 'init', async (): Promise<PluginInstance> => {
                const factory = await this.loadFactory(record);
                const created = factory();
                await created.init(host);
                return created;
            });

            record.instance = instance;
            await this.setStatus(pluginId, 'active');
            this.pluginLog.for(pluginId).info('plugin active', { version: record.manifest.version, kind: record.manifest.kind });
        } catch (error) {
            record.instance = undefined;
            await this.setStatus(pluginId, 'failed', errorText(error));
            this.pluginLog.for(pluginId).error('plugin failed to initialize', { error: errorText(error) });
        }
    }

    private async disposeNow(pluginId: string): Promise<void> {
        const record = this.pluginRegistry.get(pluginId);
        const instance = record?.instance;
        if (!record || !instance) return;

        try {
            if (typeof instance.dispose === 'function') {
                await this.pluginInvoker.invoke(pluginId, 'dispose', async () => instance.dispose?.());
            }
        } catch (error) {
            // A plugin that cannot clean up still has to be let go of, or a
            // reinit would run forever against a corpse.
            this.pluginLog.for(pluginId).warn('plugin dispose failed; dropping the instance anyway', { error: errorText(error) });
        }

        record.instance = undefined;

        // After `dispose`, deliberately: a plugin closing its own streams in
        // there is the well-behaved case and this finds nothing left to do. It is
        // the backstop for the other case, and it must run even when dispose
        // threw, or a plugin that crashed on the way out would leave a socket
        // held open by an instance nothing can reach any more.
        this.pluginHostFactory.closeStreamsFor(pluginId);

        // Transient: an init immediately after (the reinit path) overwrites this
        // with the real outcome.
        if (record.status === 'active') this.pluginRegistry.setStatus(pluginId, 'disabled');
    }

    /**
     * Runs the stored configuration through the manifest's own schema and
     * returns operator-facing error text, or `undefined` when it validates.
     *
     * The schema describes the settings FORM, so it is checked against plain
     * values and decrypted secrets merged back together. Neither the values nor
     * anything derived from them is logged; only zod's field paths and messages
     * escape this method.
     */
    private async validateConfig(manifest: PluginManifest, config: PluginConfigRecord): Promise<string | undefined> {
        let secrets: Record<string, string>;
        try {
            secrets = await this.pluginConfigService.getSecrets(manifest.id);
        } catch (error) {
            return `stored secrets could not be decrypted: ${errorText(error)}`;
        }

        const submitted: Record<string, unknown> = { ...config.config, ...secrets };
        // The OAuth vault is the host's, not a declared config field; a strict
        // schema would reject it.
        delete submitted[PLUGIN_OAUTH_SECRET_KEY];

        try {
            const parsed = manifest.configSchema.safeParse(submitted);
            if (parsed.success) return undefined;
            const issues = parsed.error.issues.map(issue => `${issue.path.join('.') || '(root)'}: ${issue.message}`).join('; ');
            return `configuration is invalid: ${issues}`;
        } catch (error) {
            // configSchema is plugin code: a refinement may throw.
            return `configuration could not be validated: ${errorText(error)}`;
        }
    }

    /**
     * The plugin's factory, taken from the entry its package.json declares.
     *
     * The loader does not keep the factory on the record (records are plain data
     * that survive being handed to the HTTP layer), so it is re-imported here.
     * That is free: Node caches ES modules by URL, so this resolves to the exact
     * module object discovery already evaluated rather than running it twice.
     */
    private async loadFactory(record: PluginRecord): Promise<PluginFactory> {
        const raw = await readFile(resolve(record.dir, 'package.json'), 'utf8');
        const entry = (JSON.parse(raw) as { deadair?: { plugin?: unknown } }).deadair?.plugin;
        if (typeof entry !== 'string' || entry.length === 0) {
            throw new Error(`plugin directory "${record.dir}" no longer declares a "deadair.plugin" entry`);
        }

        const module = (await import(pathToFileURL(resolve(record.dir, entry)).href)) as { default?: Partial<DeadairPlugin> };
        const factory = module.default?.factory;
        if (typeof factory !== 'function') {
            throw new Error(`plugin entry "${entry}" no longer default-exports definePlugin(manifest, factory)`);
        }
        return factory;
    }

    /**
     * Records a status in memory and in the database.
     *
     * The in-memory registry is written first and unconditionally: the status is
     * what the HTTP layer reports, and an unreachable database must not cost the
     * process its own view of what is running.
     */
    private async setStatus(pluginId: string, status: PluginStatus, error?: string): Promise<void> {
        this.pluginRegistry.setStatus(pluginId, status, error);
        try {
            await this.pluginConfigService.setStatus(pluginId, status, error);
        } catch (writeError) {
            this.pluginLog.for(pluginId).warn('could not persist plugin status', { status, error: errorText(writeError) });
        }
    }

    /**
     * Appends to this plugin's work queue. A rejection is swallowed for the
     * benefit of the NEXT task only: the returned promise still settles the way
     * `task` did.
     */
    private enqueue(pluginId: string, task: () => Promise<void>): Promise<void> {
        const previous = this.queues.get(pluginId) ?? Promise.resolve();
        const next = previous.then(task, task);
        this.queues.set(
            pluginId,
            next.catch(() => undefined),
        );
        return next;
    }
}
