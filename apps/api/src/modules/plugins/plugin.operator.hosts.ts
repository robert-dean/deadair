import { Injectable } from 'injectkit';
import { PluginConfigRepository } from './plugin.config.repository.js';
import { operatorHosts } from './plugin.host.factory.js';
import { PluginRegistry } from './plugin.registry.js';

/**
 * The servers the operator has pointed an enabled plugin at, as `host` strings (`nas.lan:4533`).
 *
 * The station-wide form of the rule `packages/plugin-sdk/CLAUDE.md` § "Trust and egress" states for a
 * plugin's own fetches: a host the operator supplied through a `fromConfig` setting is theirs and may
 * be on the LAN, and a host that arrived in remote content is resolved and refused if it is private.
 * The host factory applies that per plugin; this answers it for code holding a URL with no plugin
 * attached, which is what an art URL on a catalog row is.
 *
 * ENABLED rather than active: the operator's statement is the setting and the switch, and a Navidrome
 * that failed to start because the server was rebooting is still the operator's Navidrome. A disabled
 * plugin's address is not vouched for, since the operator has said they are not using it.
 *
 * The union across plugins, because nothing records which plugin minted a URL. So an origin the
 * operator gave any enabled plugin is trusted for all of them; the cost is bounded by that list being
 * one the operator typed.
 *
 * Read from the config table on every call, with no cache: the caller decides how long an answer
 * lives, and `ArtCacheService` keeps it for one sweep.
 */
@Injectable()
export class PluginOperatorHosts {
    constructor(
        private readonly registry: PluginRegistry,
        private readonly configs: PluginConfigRepository,
    ) {}

    async list(): Promise<ReadonlySet<string>> {
        const hosts = new Set<string>();

        for (const row of await this.configs.list()) {
            if (!row.enabled) continue;
            // A row whose plugin is not loaded has no manifest to say which of its settings are
            // addresses, and a guess would be the permissive direction.
            const manifest = this.registry.get(row.pluginId)?.manifest;
            if (manifest === undefined) continue;

            for (const host of operatorHosts(manifest.permissions.network, row.config, manifest.configFields)) hosts.add(host);
        }

        return hosts;
    }
}
