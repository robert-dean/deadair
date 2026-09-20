import { Injectable } from 'injectkit';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { PLUGIN_CAPABILITY_ENRICHMENT } from '@deadair/plugin-sdk';

import { AccessControlService, isAllVisible } from '#modules/permissions/access.control.service.js';
import { PluginConfigRepository } from './plugin.config.repository.js';
import { pluginOrder } from './plugin.order.js';
import { PROVIDER_CAPABILITIES, pluginsInOrder, type ProviderCapability } from './plugin.providers.js';
import { PluginRegistry } from './plugin.registry.js';
import { selectPlugin } from './plugin.selection.js';
import type { PluginRecord } from './types/plugin.record.js';
import type { ProviderCandidate, ProviderCapabilityState, ProviderCatalogue } from './types/plugins.types.js';

/**
 * What the console needs to show an operator who does a job, who could, and in
 * what order the station asks.
 *
 * ## Why this is on the host rather than assembled in the browser
 *
 * Everything here is derivable from `/plugins` and `/settings`, and for a while
 * some of it was: `declared.options.ts` in the console carried its own copy of
 * `selectPlugin`'s "an empty setting means the first by id" rule, so that the
 * model list it offered would be the chosen plugin's. A copy of a rule is a
 * copy that can be right today. The rules it would have to copy now are the two
 * in `selectPlugin`, the fallback-per-capability in `plugin.order.ts`, and
 * enrichment's declared `priority` — which is not on `PluginSummary` at all and
 * would have to be put there for the console to sort by it.
 *
 * So the station answers instead, through the same table and the same two
 * helpers its own services call. A settings page that confidently names a
 * different plugin than the one doing the work is the failure this shape
 * forecloses.
 *
 * ## It reports and never decides
 *
 * Nothing here writes. The operator's change goes through `PUT /settings` like
 * any other setting, and the next read of this answers differently because the
 * config layer behind it did.
 */
@Injectable()
export class PluginProvidersService {
    constructor(
        private readonly pluginRegistry: PluginRegistry,
        private readonly pluginConfigRepository: PluginConfigRepository,
        private readonly config: AppConfig,
        private readonly accessControl: AccessControlService,
    ) {}

    /**
     * Every capability an operator chooses between, in the table's own order.
     *
     * Capabilities with nothing installed that could answer are left out
     * entirely: a station with no charts plugin has no question to answer about
     * chart plugins, and a page listing every capability the SDK defines would
     * be mostly empty rows explaining absences.
     */
    async listProviders(): Promise<ProviderCatalogue> {
        const visible = await this.accessControl.listVisibleIds('plugin', 'view');
        const visibleIds = isAllVisible(visible) ? undefined : new Set(visible.ids);
        const records = this.pluginRegistry.list();
        // One query for every plugin's enabled flag, rather than the per-plugin read model
        // `listPlugins` builds: that one decrypts secrets and shapes a config form, and the only
        // thing wanted here is whether the operator has switched the plugin on.
        const enabled = new Set((await this.pluginConfigRepository.list()).filter(row => row.enabled).map(row => row.pluginId));

        const capabilities = Object.values(PROVIDER_CAPABILITIES)
            .map(capability => this.stateOf(capability, records, enabled, visibleIds))
            .filter(state => state.candidates.length > 0);

        return { capabilities };
    }

    /**
     * One capability's standing.
     *
     * The active candidates come from {@link pluginsInOrder}, which is the call
     * the capability's own service makes, so their order here IS the order the
     * station asks in rather than a reconstruction of it. Everything else on a
     * row is drawn from the record.
     */
    private stateOf(
        capability: ProviderCapability,
        records: readonly PluginRecord[],
        enabled: ReadonlySet<string>,
        visibleIds: Set<string> | undefined,
    ): ProviderCapabilityState {
        const configured = this.config.get(capability.settingKey, '');
        const active = pluginsInOrder(records, this.config, capability);
        const activeIds = new Set(active.map(plugin => plugin.record.id));

        // An `ordered` setting holds rows and a `one` setting holds an id. Both answer the
        // question "which ids did the operator name", which is what `listed` and `stale` are about.
        const named = capability.mode === 'ordered' ? pluginOrder(this.config, capability.settingKey) : [configured.trim()].filter(id => id.length > 0);

        // `selectPlugin`'s two rules, over the same candidates the service passes it. For an
        // `ordered` capability every active candidate is reached, so there is nothing to choose.
        const chosen = capability.mode === 'one' ? selectPlugin(active, configured) : undefined;

        const candidates: ProviderCandidate[] = active.map((plugin, index) => ({
            ...this.candidate(plugin.record, capability, named, enabled),
            position: index + 1,
            inUse: capability.mode === 'ordered' || plugin.record.id === chosen?.record.id,
        }));

        // Plugins that DECLARE the capability and cannot currently answer it: disabled, failed,
        // quarantined. They carry no position, because they are not in any asking order, but the
        // console has to draw them or "why is my weather plugin not here" has no answer on the
        // page that is supposed to answer it.
        const idle = records
            .filter(record => !activeIds.has(record.id) && (record.manifest?.capabilities ?? []).includes(capability.capability))
            .map(record => ({ ...this.candidate(record, capability, named, enabled), inUse: false }));

        return {
            capability: capability.capability,
            mode: capability.mode,
            settingKey: capability.settingKey,
            configured,
            candidates: [...candidates, ...idle].filter(candidate => visibleIds === undefined || visibleIds.has(candidate.pluginId)),
            // Ordering never gates, so a stale id costs the station nothing — which is exactly
            // why it has to be SHOWN. Silent and harmless is still a line in a settings table
            // that does nothing, and an operator cannot tell it from one that works.
            stale: named.filter(id => !activeIds.has(id)),
            unanswered: capability.mode === 'one' && named.length > 0 && chosen === undefined,
        };
    }

    /** The part of a row that is true whether or not the plugin can currently answer. */
    private candidate(
        record: PluginRecord,
        capability: ProviderCapability,
        named: readonly string[],
        enabled: ReadonlySet<string>,
    ): Omit<ProviderCandidate, 'inUse'> {
        const declaredPriority = capability.capability === PLUGIN_CAPABILITY_ENRICHMENT ? this.declaredPriorityOf(record) : undefined;

        return {
            pluginId: record.id,
            // The plugin's own name, falling back to its id for a quarantined candidate, which has
            // no manifest to have a name in.
            name: record.manifest?.name ?? record.id,
            enabled: enabled.has(record.id),
            status: record.status,
            listed: named.includes(record.id),
            ...(declaredPriority === undefined ? {} : { declaredPriority }),
        };
    }

    /**
     * What an enrichment plugin's author said about their own source.
     *
     * Read off the instance rather than through `asEnrichmentPlugin`, because
     * this has to answer for a plugin that is NOT a candidate — a disabled one
     * the operator is deciding whether to promote — and every capability view
     * declines those by design. A plugin with no instance loaded has nothing to
     * report, which is `undefined` rather than the default: showing 500 for a
     * plugin that never said so invents an opinion.
     */
    private declaredPriorityOf(record: PluginRecord): number | undefined {
        const declared: unknown = (record.instance as { priority?: unknown } | undefined)?.priority;
        return typeof declared === 'number' && Number.isFinite(declared) ? declared : undefined;
    }
}
