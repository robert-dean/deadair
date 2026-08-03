import { Injectable } from 'injectkit';
import { httpError } from '@maroonedsoftware/errors';
import { Logger } from '@maroonedsoftware/logger';
import { PLUGIN_CAPABILITY_OAUTH, type ConfigField, type PluginManifest } from '@deadair/plugin-sdk';
import { AccessControlService, isAllVisible } from '#modules/permissions/access.control.service.js';
import { PLUGIN_OAUTH_SECRET_KEY } from './plugin.host.factory.js';
import { PluginConfigService, type PluginConfigReadModel } from './plugin.config.service.js';
import { PluginEchoTracker } from './plugin.echo.tracker.js';
import { PluginInvoker } from './plugin.invoker.js';
import { PluginLifecycleManager } from './plugin.lifecycle.manager.js';
import { PluginOAuthStateStore } from './plugin.oauth.state.store.js';
import { PluginRegistry } from './plugin.registry.js';
import type { PluginRecord } from './types/plugin.record.js';
import type {
    PluginConfigInput,
    PluginDetail,
    PluginListQuery,
    PluginOAuthCallbackQuery,
    PluginOAuthResult,
    PluginSummary,
    PluginTestResult,
} from './types/plugins.types.js';

/** Stand-in for manifest fields a quarantined plugin never produced. */
const UNKNOWN = 'unknown';

/**
 * The OAuth surface of a plugin instance. Deliberately structural rather than
 * `MusicProviderOAuth`: `oauth` is a capability any kind of plugin may declare,
 * so this must not be tied to the music-provider contract.
 */
interface PluginOAuthCapability {
    getAuthorizeUrl(state: string): Promise<string>;
    handleCallback(params: Record<string, string>): Promise<void>;
}

/**
 * A `ServerkitError`'s `message` is the bare status text ("Forbidden") and the
 * useful sentence lives in `details.message`.
 */
const errorText = (error: unknown): string => {
    if (!(error instanceof Error)) return String(error);
    const details = (error as { details?: Record<string, unknown> }).details;
    const detail = details?.message;
    return typeof detail === 'string' && detail.length > 0 ? detail : error.message;
};

/** A secret submitted blank clears the stored value; an omitted one keeps it. */
const isClearedSecret = (value: unknown): boolean => value === undefined || value === null || (typeof value === 'string' && value.trim() === '');

const isCallable = (value: unknown): boolean => typeof value === 'function';

/**
 * The operator-facing plugin API.
 *
 * Everything here is a read model or a lifecycle nudge; nothing calls plugin
 * code directly. Calls that do reach a plugin (`testConnection`, the OAuth
 * pair) go through {@link PluginInvoker} so a third-party hang or throw cannot
 * escape into the request.
 *
 * The one rule the whole class exists to keep: no secret value, plaintext or
 * ciphertext, may appear in anything returned from here. Secrets are reported
 * only as `secretsConfigured[key]: boolean`, which is what
 * {@link PluginConfigService.getReadModel} hands back.
 */
@Injectable()
export class PluginsService {
    constructor(
        private readonly pluginRegistry: PluginRegistry,
        private readonly pluginConfigService: PluginConfigService,
        private readonly pluginInvoker: PluginInvoker,
        private readonly pluginLifecycleManager: PluginLifecycleManager,
        private readonly pluginEchoTracker: PluginEchoTracker,
        private readonly pluginOAuthStateStore: PluginOAuthStateStore,
        private readonly accessControl: AccessControlService,
        private readonly logger: Logger,
    ) {}

    /**
     * Narrows on top of the route policy's authentication floor: a caller who
     * is signed in but does not hold `permission` on this specific plugin is
     * denied here, per-object, before any lookup runs.
     */
    private async requirePluginPermission(id: string, permission: string): Promise<void> {
        await this.accessControl.require({ namespace: 'plugin', id }, permission);
    }

    /**
     * Every known plugin, optionally narrowed to one kind, filtered to the
     * ones the current actor may view. Quarantined ones are included.
     */
    async listPlugins(query: PluginListQuery): Promise<PluginSummary[]> {
        const visible = await this.accessControl.listVisibleIds('plugin', 'view');
        const records = this.pluginRegistry.list(query.kind === undefined ? undefined : { kind: query.kind });
        // Only admins hit the `{ all: true }` path via role coverage, so the
        // tuple walk runs for every other user, listeners included.
        let narrowed = records;
        if (!isAllVisible(visible)) {
            const visibleIds = new Set(visible.ids);
            narrowed = records.filter(record => visibleIds.has(record.id));
        }
        return Promise.all(narrowed.map(async record => this.toSummary(record, await this.readModelOf(record))));
    }

    /** @throws 404 when no plugin with that id is installed. */
    async getPlugin(id: string): Promise<PluginDetail> {
        await this.requirePluginPermission(id, 'view');
        return this.detailOf(this.requireRecord(id));
    }

    /**
     * Applies a submitted settings form: validated against the plugin's own
     * schema, secrets encrypted individually, then the plugin is reinitialized
     * so the change takes effect without a restart.
     *
     * The reinit is requested here rather than left to the notify trigger, so
     * the save is announced to {@link PluginEchoTracker} first: otherwise the
     * listener would run a second, concurrent init off the same change.
     *
     * @throws 404 unknown id, 409 quarantined plugin, 422 the plugin's schema
     *   rejected the result.
     */
    async updatePluginConfig(id: string, body: PluginConfigInput): Promise<PluginDetail> {
        await this.requirePluginPermission(id, 'configure');
        const { record, manifest } = this.requireLoaded(id);

        await this.validateSubmission(manifest, body.config);
        await this.announceWrite(id, async () => {
            await this.pluginConfigService.saveConfig(id, manifest.configFields, body.config);
        });
        // The status writes this makes announce their own echoes; do not count
        // them here.
        await this.pluginLifecycleManager.reinitPlugin(id);

        return this.detailOf(record);
    }

    /** @throws 404 unknown id, 409 quarantined plugin. */
    async enablePlugin(id: string): Promise<PluginDetail> {
        await this.requirePluginPermission(id, 'enable');
        const { record } = this.requireLoaded(id);
        return this.setEnabled(record, true);
    }

    /**
     * Disabling is allowed even for a quarantined plugin: switching off
     * something the host could not load is exactly what an operator wants to do
     * about it.
     *
     * @throws 404 when no plugin with that id is installed.
     */
    async disablePlugin(id: string): Promise<PluginDetail> {
        await this.requirePluginPermission(id, 'enable');
        return this.setEnabled(this.requireRecord(id), false);
    }

    /**
     * Runs the plugin's own `testConnection()`.
     *
     * Always resolves: a failing connection is the answer to the question, not
     * an error, so it comes back as `{ ok: false }` with the reason rather than
     * a non-2xx.
     *
     * @throws 404 when no plugin with that id is installed.
     */
    async testPlugin(id: string): Promise<PluginTestResult> {
        await this.requirePluginPermission(id, 'configure');
        const record = this.requireRecord(id);
        const instance = record.instance;

        if (!instance) {
            const reason = record.error ? `: ${record.error}` : '';
            return { ok: false, message: `plugin is not running (status: ${record.status})${reason}` };
        }
        if (!isCallable(instance.testConnection)) return { ok: false, message: 'not supported' };

        try {
            const result = await this.pluginInvoker.invoke(id, 'testConnection', async () => instance.testConnection!());
            return { ok: result.ok, message: result.message };
        } catch (error) {
            return { ok: false, message: errorText(error) };
        }
    }

    /** Rescans the mounted directory, then reports the catalogue as it now stands. */
    async rescanPlugins(): Promise<PluginSummary[]> {
        await this.pluginLifecycleManager.rescan();
        return this.listPlugins({});
    }

    /**
     * Starts the plugin's OAuth flow. The generated router turns the returned
     * header into a 302.
     *
     * The `state` is minted and remembered by the HOST, then handed to the
     * plugin to put in the authorize URL. The plugin may do what it likes with
     * it, but it is the host that recognises it again on the callback: the
     * callback route is anonymous, so that check is a host security boundary
     * and cannot be left to third-party code to remember to implement.
     *
     * @throws 404 unknown id, 409 quarantined plugin, 501 no OAuth capability,
     *   503 the plugin is installed but not running.
     */
    async startOAuthAuthorization(id: string): Promise<{ headers: { location?: string } }> {
        await this.requirePluginPermission(id, 'oauth');
        const { record, manifest } = this.requireLoaded(id);
        const oauth = this.requireOAuth(record, manifest);

        // Minted only once everything above has passed, so a request that ends
        // in a 404/409/501/503 does not supersede a live authorization.
        const state = this.pluginOAuthStateStore.issue(id);

        const location = await this.pluginInvoker.invoke(id, 'oauth.getAuthorizeUrl', async () => oauth.getAuthorizeUrl(state));
        return { headers: { location } };
    }

    /**
     * Completes the flow. The plugin persists whatever it got through
     * `host.oauth.saveTokens`, which stores them as encrypted plugin secrets.
     *
     * This route is anonymous — the provider redirects a browser here carrying
     * no session of ours — so a failure comes back as a fixed sentence and the
     * detail goes to the log only.
     *
     * The `state` minted at authorize time is therefore the only thing that
     * distinguishes a real callback from one an attacker made a browser issue,
     * and it is checked here BEFORE anything else: before the plugin is looked
     * up, before `?error=` is interpreted, and above all before any plugin code
     * runs. A callback that fails the check gets the same neutral sentence as
     * any other failure, so a prober cannot tell a bad state from a bad code.
     *
     * @throws 404 unknown id, 409 quarantined plugin, 501 no OAuth capability,
     *   503 the plugin is installed but not running.
     */
    async completeOAuthCallback(id: string, query: PluginOAuthCallbackQuery): Promise<PluginOAuthResult> {
        // Denial redirects carry `state` too, so this covers `?error=` callbacks
        // as well: every callback must prove it belongs to an authorization this
        // host started.
        if (!this.pluginOAuthStateStore.consume(id, query.state)) {
            // The state value itself is never logged: it is a bearer token for
            // the rest of its (short) life.
            this.logger.warn('plugin oauth callback rejected: state did not validate', {
                plugin: id,
                reason: query.state === undefined ? 'absent' : 'unrecognized',
            });
            return { pluginId: id, ok: false, message: 'the authorization could not be completed' };
        }

        const { record, manifest } = this.requireLoaded(id);

        if (query.error !== undefined) {
            this.logger.warn('plugin oauth callback reported an error', { plugin: id, error: query.error });
            return { pluginId: id, ok: false, message: 'the provider declined the authorization request' };
        }

        const oauth = this.requireOAuth(record, manifest);

        const params: Record<string, string> = {};
        for (const [key, value] of Object.entries(query)) {
            if (typeof value === 'string') params[key] = value;
        }

        try {
            await this.pluginInvoker.invoke(id, 'oauth.handleCallback', async () => oauth.handleCallback(params));
        } catch (error) {
            this.logger.error('plugin oauth callback failed', { plugin: id, error: errorText(error) });
            return { pluginId: id, ok: false, message: 'the authorization could not be completed' };
        }

        this.logger.info('plugin oauth callback completed', { plugin: id });
        return { pluginId: id, ok: true };
    }

    /** Flips the stored flag, then reinitializes so the running state matches it. */
    private async setEnabled(record: PluginRecord, enabled: boolean): Promise<PluginDetail> {
        await this.announceWrite(record.id, async () => {
            await this.pluginConfigService.setEnabled(record.id, enabled);
        });
        // `reinitPlugin` covers both directions: its init step re-reads the flag
        // and stops at a `disabled` status instead of instantiating. Its own
        // status write announces its own echo.
        await this.pluginLifecycleManager.reinitPlugin(record.id);
        return this.detailOf(record);
    }

    /**
     * Runs a single-row write to `plugin_configs`, announced to the echo tracker
     * so the notification it fires does not turn into a reinit on top of the one
     * the caller performs itself.
     *
     * One upsert affects one row, and the trigger is per-row, so exactly one
     * notification is expected. The expectation is registered before the write
     * (a notification can land while the statement's promise is still settling)
     * and withdrawn when the write throws, since then nothing was written and no
     * notification is coming.
     */
    private async announceWrite(pluginId: string, write: () => Promise<void>): Promise<void> {
        this.pluginEchoTracker.expectEcho(pluginId);
        try {
            await write();
        } catch (error) {
            this.pluginEchoTracker.retractEcho(pluginId);
            throw error;
        }
    }

    /**
     * Runs the submission through the plugin's own zod schema before anything is
     * written.
     *
     * The schema describes the whole settings form, so it is checked against the
     * form as it WILL be: stored plain values and stored secrets, overlaid with
     * the submitted keys. That is what makes a partial submission legal — an
     * operator who did not retype a secret still satisfies a schema that
     * requires it.
     *
     * Only zod's field paths and messages escape; no value is echoed or logged.
     */
    private async validateSubmission(manifest: PluginManifest, submitted: Record<string, unknown>): Promise<void> {
        const effective = await this.effectiveConfig(manifest, submitted);

        let issues: string;
        try {
            const parsed = manifest.configSchema.safeParse(effective);
            if (parsed.success) return;
            issues = parsed.error.issues.map(issue => `${issue.path.join('.') || '(root)'}: ${issue.message}`).join('; ');
        } catch (error) {
            // `configSchema` is plugin code; a refinement may throw.
            throw httpError(422).withDetails({ message: `configuration could not be validated: ${errorText(error)}` });
        }

        throw httpError(422).withDetails({ message: `configuration is invalid: ${issues}` });
    }

    /** The settings form as it will stand once `submitted` is saved. */
    private async effectiveConfig(manifest: PluginManifest, submitted: Record<string, unknown>): Promise<Record<string, unknown>> {
        const stored = await this.pluginConfigService.getConfig(manifest.id);

        let secrets: Record<string, string>;
        try {
            secrets = await this.pluginConfigService.getSecrets(manifest.id);
        } catch (error) {
            this.logger.error('stored plugin secrets could not be decrypted', { plugin: manifest.id, error: errorText(error) });
            throw httpError(500).withDetails({ message: `stored secrets for "${manifest.id}" could not be decrypted` });
        }
        // The OAuth vault is the host's, not a declared config field; a strict
        // schema would reject it.
        delete secrets[PLUGIN_OAUTH_SECRET_KEY];

        const effective: Record<string, unknown> = { ...stored, ...secrets };

        // Only declared fields are folded in, matching what `saveConfig` will
        // actually persist: validating keys it is about to drop would be a lie.
        for (const field of manifest.configFields) {
            if (field.type === 'note') continue;
            if (!Object.hasOwn(submitted, field.key)) continue;

            if (field.type === 'secret' && isClearedSecret(submitted[field.key])) {
                delete effective[field.key];
                continue;
            }
            effective[field.key] = submitted[field.key];
        }

        return effective;
    }

    private requireRecord(id: string): PluginRecord {
        const record = this.pluginRegistry.get(id);
        if (!record) throw httpError(404).withDetails({ message: `plugin "${id}" is not installed` });
        return record;
    }

    /** A record whose manifest loaded. Anything else cannot be configured or run. */
    private requireLoaded(id: string): { record: PluginRecord; manifest: PluginManifest } {
        const record = this.requireRecord(id);
        if (!record.manifest) {
            const reason = record.error ? `: ${record.error}` : '';
            throw httpError(409).withDetails({ message: `plugin "${id}" could not be loaded${reason}` });
        }
        return { record, manifest: record.manifest };
    }

    /**
     * A declared capability is only a promise, so the instance is checked for
     * the methods too: calling one the plugin forgot to write would be a
     * `TypeError` in the middle of a request rather than an honest 501.
     */
    private requireOAuth(record: PluginRecord, manifest: PluginManifest): PluginOAuthCapability {
        if (!manifest.capabilities.includes(PLUGIN_CAPABILITY_OAUTH)) {
            throw httpError(501).withDetails({ message: `plugin "${record.id}" does not support OAuth` });
        }

        const instance = record.instance;
        if (!instance) {
            const reason = record.error ? `: ${record.error}` : '';
            throw httpError(503).withDetails({ message: `plugin "${record.id}" is not running (status: ${record.status})${reason}` });
        }

        const candidate = instance as unknown as Partial<PluginOAuthCapability>;
        if (!isCallable(candidate.getAuthorizeUrl) || !isCallable(candidate.handleCallback)) {
            throw httpError(501).withDetails({ message: `plugin "${record.id}" declares OAuth but does not implement it` });
        }
        return candidate as PluginOAuthCapability;
    }

    private async readModelOf(record: PluginRecord): Promise<PluginConfigReadModel> {
        const fields: ConfigField[] = record.manifest?.configFields ?? [];
        return this.pluginConfigService.getReadModel(record.id, fields);
    }

    private async detailOf(record: PluginRecord): Promise<PluginDetail> {
        const readModel = await this.readModelOf(record);
        return {
            ...this.toSummary(record, readModel),
            config: readModel.config,
            // The in-memory record is the fresher of the two: it carries the
            // reason for a status the database has not been told about yet.
            lastError: record.error ?? readModel.lastError,
        };
    }

    private toSummary(record: PluginRecord, readModel: PluginConfigReadModel): PluginSummary {
        const manifest = record.manifest;
        return {
            id: record.id,
            name: manifest?.name ?? record.id,
            version: manifest?.version ?? UNKNOWN,
            kind: manifest?.kind ?? UNKNOWN,
            capabilities: manifest?.capabilities ?? [],
            status: record.status,
            enabled: readModel.enabled,
            // A quarantined candidate has no manifest to describe itself with,
            // so the quarantine reason stands in for the description.
            description: manifest?.description ?? record.error,
            icon: manifest?.icon,
            configFields: manifest?.configFields ?? [],
            secretsConfigured: readModel.configured,
        };
    }
}
