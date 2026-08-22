import { Injectable } from 'injectkit';
import { httpError } from '@maroonedsoftware/errors';
import { PgBossJobBroker } from '@maroonedsoftware/jobbroker/pgboss';
import { Logger } from '@maroonedsoftware/logger';
import { PLUGIN_CAPABILITY_OAUTH, type ConfigField, type ConfigFieldOption, type PluginManifest } from '@deadair/plugin-sdk';
import { AfterCommit } from '#modules/data/after.commit.js';
import { ActivityRecorder } from '#modules/activity/activity.recorder.js';
import { AccessControlService, isAllVisible } from '#modules/permissions/access.control.service.js';
import { AuthorizationContext } from '#modules/permissions/authorization.context.js';
import { safeChannel } from '#src/logging/rotating.log.store.js';
import { OAUTH_SECRET_FIELD, PLUGIN_OAUTH_SECRET_KEY } from './plugin.oauth.secret.js';
import { PluginConfigService, type PluginConfigReadModel } from './plugin.config.service.js';
import { asCatalogPlugin } from './plugin.capabilities.js';
import { pluginHttpError } from './plugin.error.http.js';
import { PluginInvoker } from './plugin.invoker.js';
import { PluginLifecycleManager } from './plugin.lifecycle.manager.js';
import { PluginLog } from './plugin.log.js';
import { PluginOAuthStateStore } from './plugin.oauth.state.store.js';
import { PluginRegistry } from './plugin.registry.js';
import { capabilityOf } from './plugin.grants.js';
import { PluginGrantsService } from './plugin.grants.service.js';
import type { PluginRecord } from './types/plugin.record.js';
import type {
    PluginConfigInput,
    PluginDetail,
    PluginGrant,
    PluginGrantInput,
    PluginGrantList,
    PluginLogEntry,
    PluginLogLevel,
    PluginLogLevelInput,
    PluginLogPage,
    PluginLogQuery,
    PluginOAuthCallbackQuery,
    PluginOAuthResult,
    PluginOAuthStart,
    PluginFieldSuggestions,
    PluginSummary,
    PluginTestResult,
} from './types/plugins.types.js';
import { serverkitErrorText } from '#modules/shared/error.text.js';

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

/** A secret submitted blank clears the stored value; an omitted one keeps it. */
const isClearedSecret = (value: unknown): boolean => value === undefined || value === null || (typeof value === 'string' && value.trim() === '');

const isCallable = (value: unknown): boolean => typeof value === 'function';

/**
 * Most options a plugin may offer for one field, and most fields it may answer for.
 *
 * A model server with a few dozen models is ordinary; a dropdown with ten thousand entries is a
 * console that stops responding. Truncated rather than refused, because a long list is still a
 * usable one and the fields these decorate are all free text underneath.
 */
const MAX_SUGGESTED_OPTIONS = 500;
const MAX_SUGGESTED_FIELDS = 50;

/**
 * A plugin's suggestions, as something the console can definitely render.
 *
 * Plugins are trusted code (`docs/decisions/plugin-trust.md`), so this is not a security boundary
 * and does not pretend to be one. It is the same care `toPluginError` takes for the same reason:
 * this value is about to be JSON and then a form, and a plugin returning a number where a label
 * belongs should cost that entry rather than the whole settings page.
 */
function sanitizeSuggestions(suggested: unknown): Record<string, ConfigFieldOption[]> {
    if (typeof suggested !== 'object' || suggested === null) return {};

    const fields: Record<string, ConfigFieldOption[]> = {};

    for (const [key, raw] of Object.entries(suggested as Record<string, unknown>).slice(0, MAX_SUGGESTED_FIELDS)) {
        if (!Array.isArray(raw)) continue;

        const options: ConfigFieldOption[] = [];
        for (const entry of raw.slice(0, MAX_SUGGESTED_OPTIONS)) {
            if (typeof entry !== 'object' || entry === null) continue;
            const { value, label } = entry as Partial<ConfigFieldOption>;
            if (typeof value !== 'string' || value.length === 0) continue;
            // A missing label is the ordinary case for a list of ids, not a fault.
            options.push({ value, label: typeof label === 'string' && label.length > 0 ? label : value });
        }

        // Absent rather than present-and-empty, so a console can tell a field with nothing to
        // suggest from one the plugin never mentioned.
        if (options.length > 0) fields[key] = options;
    }

    return fields;
}

const PLUGIN_LOG_LEVELS = new Set<string>(['debug', 'info', 'warn', 'error'] satisfies PluginLogLevel[]);

/**
 * `RotatingLogStore.tail()` reads its own lines back off disk as plain
 * `{ level: string }` (upper-cased, or `''` for a line that failed to
 * parse): its `LogEntry` is deliberately wider than the plugin-facing
 * contract's `debug|info|warn|error` enum, per `LogLevel`'s own doc comment
 * ("That narrowing is `PluginLog`'s job"). This is that narrowing, at the
 * one place it turns into an HTTP response: an unrecognized or unparsed
 * token falls back to `info` rather than failing the whole page.
 */
const toPluginLogLevel = (level: string): PluginLogLevel => {
    const lowered = level.toLowerCase();
    return PLUGIN_LOG_LEVELS.has(lowered) ? (lowered as PluginLogLevel) : 'info';
};

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
        private readonly pluginOAuthStateStore: PluginOAuthStateStore,
        private readonly pluginGrants: PluginGrantsService,
        private readonly accessControl: AccessControlService,
        private readonly pluginLog: PluginLog,
        private readonly afterCommit: AfterCommit,
        // The SINGLETON broker rather than the scoped `JobBroker`, which is the one distinction that
        // matters here: the scoped one enlists in the request's transaction, and the only send in
        // this class runs from `AfterCommit`, which by definition is after that transaction has
        // committed. Measured against the running station — the send answered
        // "Transaction is already committed" and the sync silently never happened, which the unit
        // test could not see because a stubbed broker resolves either way.
        private readonly jobs: PgBossJobBroker,
        // Who is asking, and the feed to say so on. Every write here is an operator's decision
        // about what the station can reach, which is exactly what `station_events.actor_id` is for.
        private readonly context: AuthorizationContext,
        private readonly activity: ActivityRecorder,
        private readonly logger: Logger,
    ) {}

    /**
     * Note an operator's decision about a plugin.
     *
     * Deliberately carries the plugin's ID and NOTHING it holds: a plugin's config is credentials
     * more often than not, and the feed has no redaction pass. See the rule in `ActivityRecorder`.
     */
    private note(id: string, kind: string, detail: string): void {
        const actorId = this.context.actor.kind === 'user' ? this.context.actor.actorId : undefined;
        void this.activity.record({
            module: 'plugins',
            kind,
            detail,
            data: { pluginId: id },
            ...(actorId === undefined ? {} : { actorId }),
        });
    }

    /**
     * Reinitializes the plugin once this request's transaction has committed, and
     * not before.
     *
     * Every route below that reinitializes has just written the plugin's row, and
     * `PluginLifecycleManager` is a singleton that reads and writes that row on a
     * pooled connection of its own. Doing it inline meant it read the row as it
     * was BEFORE the write, and then its own `setStatus` upsert blocked on the
     * lock this request is holding — while this request was waiting on the
     * reinit. Measured against the dev database: the read came back pre-write and
     * the upsert was still on `Lock/transactionid` two seconds later, with no
     * `statement_timeout` to end it.
     *
     * The wait is still the operator's: `AfterCommit` runs before the response is
     * written, so a 200 here still means the plugin has been reinitialized. What
     * changed is that the detail body below is built BEFORE that happens, so its
     * `status` is the one the plugin had on the way in. The console refetches for
     * this reason.
     */
    private reinitAfterCommit(id: string): void {
        this.afterCommit.add(() => this.pluginLifecycleManager.reinitPlugin(id));
    }

    /**
     * Fill the library from a provider whose settings just changed.
     *
     * `catalog.sync` is hourly cron and nothing in the app has ever sent one, so until this existed
     * a station that had just been given its first provider had **no catalog at all** until the top
     * of the next hour. That is not a cosmetic wait: `PickResolver` matches against the catalog, the
     * ripener needs a `track_sources` row to have anything to fetch, and an operator who has just
     * finished onboarding is precisely the person about to put something on air.
     *
     * Registered AFTER {@link reinitAfterCommit}, and reading the record only once it runs, because
     * `asCatalogPlugin` asks whether the plugin can be called RIGHT NOW. Before the reinit the
     * record still holds the instance built from the old settings — on a first-time setup, no
     * instance at all — so asking early would skip a sync for exactly the plugin that most needs
     * one.
     *
     * Scoped to the plugin, which is what `CatalogSyncPayload.pluginId` has always been for and what
     * nothing ever passed. A settings save should not cost a walk of every provider the station has.
     *
     * Swallowed, unlike the reinit above it. `AfterCommit` deliberately does not catch, so a throw
     * here would reach the error handler over a config write that is already durable, and tell the
     * operator their save failed when it did not. The hourly run is the retry.
     */
    private syncCatalogAfterCommit(id: string): void {
        this.afterCommit.add(async () => {
            const record = this.pluginRegistry.get(id);
            if (!record || !asCatalogPlugin(record)) return;

            try {
                await this.jobs.send('catalog.sync', { pluginId: id });
            } catch (error) {
                this.pluginLog.for(id).warn('could not ask for a catalog sync after a settings change', { error: serverkitErrorText(error) });
            }
        });
    }

    /**
     * Narrows on top of the route policy's authentication floor: a caller who
     * is signed in but does not hold `permission` on this specific plugin is
     * denied here, per-object, before any lookup runs.
     */
    private async requirePluginPermission(id: string, permission: string): Promise<void> {
        await this.accessControl.require({ namespace: 'plugin', id }, permission);
    }

    /**
     * Every known plugin, filtered to the ones the current actor may view.
     * Quarantined ones are included.
     */
    async listPlugins(): Promise<PluginSummary[]> {
        const visible = await this.accessControl.listVisibleIds('plugin', 'view');
        const records = this.pluginRegistry.list();
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
     * @throws 404 unknown id, 409 quarantined plugin, 422 the plugin's schema
     *   rejected the result.
     */
    async updatePluginConfig(id: string, body: PluginConfigInput): Promise<PluginDetail> {
        await this.requirePluginPermission(id, 'configure');
        const { record, manifest } = this.requireLoaded(id);

        await this.validateSubmission(manifest, body.config);
        await this.pluginConfigService.saveConfig(id, manifest.configFields, body.config);
        this.reinitAfterCommit(id);
        // On the config WRITE and not on `reloadPlugin`, which writes nothing: hanging a library
        // walk off an operation that changed no settings would sync on every reload.
        this.syncCatalogAfterCommit(id);
        // Which plugin was reconfigured, never WHAT was set: half of a plugin's config is
        // credentials, and unlike the log store this table has no redaction pass.
        this.note(id, 'plugin.configured', `An operator changed the ${id} plugin's settings.`);

        return this.detailOf(record);
    }

    /** @throws 404 unknown id, 409 quarantined plugin. */
    async enablePlugin(id: string): Promise<PluginDetail> {
        await this.requirePluginPermission(id, 'enable');
        const { record } = this.requireLoaded(id);
        return this.setEnabled(record, true);
    }

    /**
     * Every capability every installed plugin is asking for, with the answer so far.
     *
     * **Built from the manifests and folded over the stored decisions, never the other way round.**
     * A plugin's manifest is the request, so this walks what is installed and asks the grant service
     * what was said about each — which means a row for a plugin that has been uninstalled, or for a
     * capability its manifest no longer asks for, simply does not appear. The alternative, listing
     * the rows, would show an operator a permission nothing is asking for and let them allow it.
     *
     * A capability this host does not publish is skipped too, with a warning: an id nothing enforces
     * would draw a control that protects nothing.
     *
     * Ordered by plugin and then by capability, which is the registry's order rather than any
     * ranking — nothing here is more urgent than anything else, and a table that reordered itself as
     * decisions were made would move the row under the operator's cursor.
     */
    async listGrants(): Promise<PluginGrantList> {
        const visible = await this.accessControl.listVisibleIds('plugin', 'view');
        const records = this.pluginRegistry.list();
        const narrowed = isAllVisible(visible) ? records : records.filter(record => new Set(visible.ids).has(record.id));

        const grants: PluginGrant[] = [];
        for (const record of [...narrowed].sort((left, right) => left.id.localeCompare(right.id))) {
            for (const asked of record.manifest?.permissions.grants ?? []) {
                const capability = capabilityOf(asked.capability);
                if (capability === undefined) {
                    this.pluginLog
                        .for(record.id)
                        .warn('plugin asked for a capability this host does not publish, so nothing can grant it', { capability: asked.capability });
                    continue;
                }

                grants.push({
                    pluginId: record.id,
                    pluginName: record.manifest?.name ?? record.id,
                    capability: capability.id,
                    label: capability.label,
                    describes: capability.describes,
                    reason: asked.reason,
                    decision: this.pluginGrants.decisionFor(record.id, capability.id),
                });
            }
        }

        return { grants };
    }

    /**
     * Answers one capability a plugin asked for.
     *
     * Gated on `plugin.configure` rather than merely on being signed in, because deciding what a
     * plugin may reach is the same weight of decision as handing it a credential.
     *
     * Refuses a capability the plugin did not ask for, which is the half that keeps the store
     * honest: a row nothing is asking for grants nothing (`openWebEntry` checks the manifest too),
     * so writing one would only put a lie in the table.
     *
     * There are two answers and denied is the default, so a refusal is written as a row rather than
     * left as an absence: both refuse, and the row is what records WHO decided and when. Nothing
     * reads the difference, which is the point — a console that could tell a fresh request from a
     * settled refusal would have to nag about both.
     *
     * @throws 404 unknown plugin. 400 for a capability this plugin never asked for.
     */
    async decideGrant(id: string, input: PluginGrantInput): Promise<PluginGrantList> {
        await this.requirePluginPermission(id, 'configure');
        const record = this.requireRecord(id);

        const asked = record.manifest?.permissions.grants?.some(request => request.capability === input.capability) === true;
        if (!asked || capabilityOf(input.capability) === undefined) {
            throw httpError(400).withDetails({ message: `plugin "${id}" is not asking for "${input.capability}"` });
        }

        const actorId = this.context.actor.kind === 'user' ? this.context.actor.actorId : undefined;
        // After the commit, for `reinitAfterCommit`'s reason in reverse: the grant service is a
        // singleton that reads on its own pooled connection, so a refresh inside this transaction
        // would rebuild its map from the rows as they stood BEFORE the write.
        this.afterCommit.add(() => this.pluginGrants.decide(id, input.capability, input.decision, actorId));

        this.note(id, `grant.${input.decision}`, `${input.capability} was ${input.decision} for ${id}`);

        // Built from what was asked rather than re-read, since the write above has not run yet. The
        // console refetches, exactly as it does after a config write.
        const current = await this.listGrants();
        return {
            grants: current.grants.map(grant =>
                grant.pluginId === id && grant.capability === input.capability ? { ...grant, decision: input.decision } : grant,
            ),
        };
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
            return { ok: false, message: serverkitErrorText(error) };
        }
    }

    /**
     * Asks the plugin what to offer for its config fields right now.
     *
     * The dynamic half of the settings form. `ConfigField.options` is fixed when
     * the manifest is written; this is whatever the operator's own server
     * currently says, which is the only way a field like "which model" can be
     * filled without reading a name out of a message and typing it back.
     *
     * Always resolves, like {@link testPlugin}: a plugin that cannot reach its
     * upstream costs the form its dropdowns, never the form. `supported: false`
     * is how a console tells "asked and got nothing" from "there is nothing to
     * ask", so it can leave the refresh control off a plugin that has no answer.
     *
     * @throws 404 when no plugin with that id is installed.
     */
    async suggestPluginConfigOptions(id: string): Promise<PluginFieldSuggestions> {
        await this.requirePluginPermission(id, 'configure');
        const record = this.requireRecord(id);
        const instance = record.instance;

        if (!instance || !isCallable(instance.suggestConfigOptions)) return { fields: {}, supported: false };

        try {
            const suggested = await this.pluginInvoker.invoke(id, 'suggestConfigOptions', async () => instance.suggestConfigOptions!());
            return { fields: sanitizeSuggestions(suggested), supported: true };
        } catch (error) {
            // Reported at info rather than warn: an unreachable upstream is the ordinary reason,
            // and it is the operator's own address rather than a fault in the station.
            this.logger.info(`plugins: could not get config suggestions from "${id}" (${serverkitErrorText(error)})`);
            return { fields: {}, supported: true };
        }
    }

    /**
     * Reapplies whatever `plugin_configs` holds for this plugin right now:
     * dispose, then init.
     *
     * Every route here that changes a plugin's configuration reinitializes it
     * itself, so this covers the one case they cannot: a row edited out of
     * band, by a psql session or a restored dump. Nothing watches the table for
     * those, deliberately. The console also uses this as a plain "restart this
     * plugin" button, which is worth having on its own.
     *
     * @throws 404 when no plugin with that id is installed.
     */
    async reloadPlugin(id: string): Promise<PluginDetail> {
        await this.requirePluginPermission(id, 'configure');
        const record = this.requireRecord(id);
        // Inline, unlike every other reinit here, and for the reason this route
        // exists: it writes nothing. There is no uncommitted row for the manager to
        // read past and no lock of ours for its `setStatus` to wait on, so it can
        // run now — which means the detail below reports the status the reload
        // actually produced.
        await this.pluginLifecycleManager.reinitPlugin(id);
        this.note(id, 'plugin.reloaded', `An operator reloaded the ${id} plugin.`);
        return this.detailOf(record);
    }

    /** Rescans the mounted directory, then reports the catalogue as it now stands. */
    async rescanPlugins(): Promise<PluginSummary[]> {
        await this.pluginLifecycleManager.rescan();
        return this.listPlugins();
    }

    /**
     * The plugin's buffered log lines from its own rotating file, filtered to
     * the requested minimum severity (or, absent one, its current in-memory
     * level).
     *
     * Available for a quarantined or failed plugin too: those are exactly the
     * ones an operator most needs a log tail for, so this checks only that the
     * id is installed, not that it loaded.
     *
     * Answered NEWEST FIRST, which is this API's own shape rather than the
     * store's: a file is written oldest-first and read from the end, and what
     * an operator opening this page wants is what just happened, at the top,
     * without scrolling a panel of whatever was retained. It matches the
     * activity feed and the script history, which send the same way. The
     * DOWNLOAD is untouched and stays the file as written, because that is a
     * log somebody greps rather than a page somebody reads.
     *
     * @throws 404 unknown id.
     */
    async getPluginLogs(id: string, query: PluginLogQuery): Promise<PluginLogPage> {
        await this.requirePluginPermission(id, 'configure');
        this.requireRecord(id);
        const level = query.level ?? this.pluginLog.levelOf(id);
        const raw = await this.pluginLog.tail(id, { limit: query.limit, level });
        const entries: PluginLogEntry[] = raw.map(entry => ({ ts: entry.ts, level: toPluginLogLevel(entry.level), text: entry.text }));
        entries.reverse();
        return { pluginId: id, level, entries };
    }

    /**
     * The plugin's full retained log as a downloadable attachment.
     *
     * The filename is built from the SANITIZED id, never the raw one: a
     * plugin id is operator-supplied, and an unsanitized id could inject a
     * quote or newline into the `Content-Disposition` header.
     *
     * @throws 404 unknown id.
     */
    async downloadPluginLogs(id: string): Promise<{ body: string; headers: { contentDisposition: string } }> {
        await this.requirePluginPermission(id, 'configure');
        this.requireRecord(id);
        const body = await this.pluginLog.readAll(id);
        return { body, headers: { contentDisposition: `attachment; filename="${safeChannel(id)}.log"` } };
    }

    /**
     * Sets the plugin's file-log verbosity going forward.
     *
     * The in-memory level, which is what actually gates the file, is updated
     * only after the write succeeds. Nothing is reinitialized: this is a
     * logging toggle, not a configuration change the plugin can observe.
     *
     * @throws 404 unknown id.
     */
    async setPluginLogLevel(id: string, body: PluginLogLevelInput): Promise<PluginDetail> {
        await this.requirePluginPermission(id, 'configure');
        const record = this.requireRecord(id);

        await this.pluginConfigService.setLogLevel(id, body.level);
        this.pluginLog.setLevel(id, body.level);

        return this.detailOf(record);
    }

    /**
     * Forgets a plugin's stored OAuth tokens, then reinitializes it.
     *
     * There is no plugin-side `disconnect()` hook: Spotify has no
     * token-revocation endpoint, and inventing one on `MusicProviderOAuth` for
     * a single provider is not worth it. Disconnecting means "the host forgets
     * the tokens" — clearing the vault secret is the same blank-clears-a-secret
     * path {@link PluginConfigService.saveConfig} already gives every other
     * secret field, reused rather than duplicated here.
     *
     * @throws 404 unknown id, 409 quarantined plugin, 501 no OAuth capability.
     */
    async disconnectOAuth(id: string): Promise<PluginDetail> {
        await this.requirePluginPermission(id, 'oauth');
        const { record, manifest } = this.requireLoaded(id);

        // Capability check only, not requireOAuth(): a plugin that is
        // connected but stopped or crashed must still be disconnectable, and
        // requireOAuth would 503 it for lacking a live instance.
        if (!manifest.capabilities.includes(PLUGIN_CAPABILITY_OAUTH)) {
            throw httpError(501).withDetails({ message: `plugin "${record.id}" does not support OAuth` });
        }

        await this.pluginConfigService.saveConfig(id, [...manifest.configFields, OAUTH_SECRET_FIELD], { [PLUGIN_OAUTH_SECRET_KEY]: '' });
        // The tokens would otherwise keep working from the plugin's in-memory
        // cache until the next reload; the reinit is what drops it.
        this.reinitAfterCommit(id);
        return this.detailOf(record);
    }

    /**
     * Starts the plugin's OAuth flow by reporting where the operator has to go.
     *
     * The URL is returned rather than redirected to because this route is
     * behind the authenticated floor: a browser sent here top-level carries no
     * `Authorization` header, and a `fetch` that follows a cross-origin 302
     * fails CORS. So the console asks for the URL and performs the navigation
     * itself, where it does have the session.
     *
     * The `state` is minted and remembered by the HOST, then handed to the
     * plugin to put in the authorize URL. The plugin may do what it likes with
     * it, but it is the host that recognises it again on the callback: the
     * callback route is anonymous, so that check is a host security boundary
     * and cannot be left to third-party code to remember to implement.
     *
     * @throws 404 unknown id, 409 quarantined plugin, 501 no OAuth capability,
     *   503 the plugin is installed but not running. If the plugin itself
     *   fails, whatever {@link pluginHttpError} makes of its `PluginError`
     *   (429/500/502/503/504), carrying an `E300xx` code in `details`.
     */
    async startOAuthAuthorization(id: string): Promise<PluginOAuthStart> {
        await this.requirePluginPermission(id, 'oauth');
        const { record, manifest } = this.requireLoaded(id);
        const oauth = this.requireOAuth(record, manifest);

        // Minted only once everything above has passed, so a request that ends
        // in a 404/409/501/503 does not supersede a live authorization.
        const state = this.pluginOAuthStateStore.issue(id);

        try {
            const url = await this.pluginInvoker.invoke(id, 'oauth.getAuthorizeUrl', async () => oauth.getAuthorizeUrl(state));
            return { url };
        } catch (error) {
            // Without this the invoker's error reaches the middleware as a plain
            // throw and every plugin-side failure renders as a 500, which tells
            // the console nothing it can act on. `pluginHttpError` is what turns
            // "the token expired" into a status and a code it can branch on.
            this.pluginLog.for(id).warn('plugin oauth authorize failed', { error: serverkitErrorText(error) });
            throw pluginHttpError(id, error);
        }
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
            this.pluginLog.for(id).warn('plugin oauth callback rejected: state did not validate', {
                reason: query.state === undefined ? 'absent' : 'unrecognized',
            });
            return { pluginId: id, ok: false, message: 'the authorization could not be completed' };
        }

        const { record, manifest } = this.requireLoaded(id);

        if (query.error !== undefined) {
            this.pluginLog.for(id).warn('plugin oauth callback reported an error', { error: query.error });
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
            this.pluginLog.for(id).error('plugin oauth callback failed', { error: serverkitErrorText(error) });
            return { pluginId: id, ok: false, message: 'the authorization could not be completed' };
        }

        this.pluginLog.for(id).info('plugin oauth callback completed');
        return { pluginId: id, ok: true };
    }

    /** Flips the stored flag, then reinitializes so the running state matches it. */
    private async setEnabled(record: PluginRecord, enabled: boolean): Promise<PluginDetail> {
        await this.pluginConfigService.setEnabled(record.id, enabled);
        // `reinitPlugin` covers both directions: its init step re-reads the flag
        // and stops at a `disabled` status instead of instantiating. It re-reads
        // it after the commit, which is what makes the flag it reads the one just
        // written — enabling a plugin used to read back the old `false` and do
        // nothing at all, quietly, with a 200.
        this.reinitAfterCommit(record.id);
        // What the station can reach changed, which is the plugin event most worth having: a
        // capability going away explains a symptom somewhere else entirely, hours later.
        this.note(
            record.id,
            enabled ? 'plugin.enabled' : 'plugin.disabled',
            `An operator ${enabled ? 'enabled' : 'disabled'} the ${record.id} plugin.`,
        );
        return this.detailOf(record);
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
            throw httpError(422).withDetails({ message: `configuration could not be validated: ${serverkitErrorText(error)}` });
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
            this.pluginLog.for(manifest.id).error('stored plugin secrets could not be decrypted', { error: serverkitErrorText(error) });
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
        // Only reported for a manifest that actually declares the capability,
        // so the console never renders a connection state for a plugin that
        // has no connection to have.
        const supportsOAuth = record.manifest?.capabilities.includes(PLUGIN_CAPABILITY_OAUTH) ?? false;
        return {
            ...this.toSummary(record, readModel),
            config: readModel.config,
            // The in-memory record is the fresher of the two: it carries the
            // reason for a status the database has not been told about yet.
            lastError: record.error ?? readModel.lastError,
            ...(supportsOAuth ? { oauthConnected: readModel.oauthConnected } : {}),
            // `levelOf` resolves the nullable stored override to the same
            // concrete value that actually gates the file, rather than
            // reading `readModel.logLevel` (which may be undefined) directly.
            logLevel: this.pluginLog.levelOf(record.id),
        };
    }

    private toSummary(record: PluginRecord, readModel: PluginConfigReadModel): PluginSummary {
        const manifest = record.manifest;
        return {
            id: record.id,
            name: manifest?.name ?? record.id,
            version: manifest?.version ?? UNKNOWN,
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
