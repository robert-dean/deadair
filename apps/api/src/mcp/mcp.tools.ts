import { Injectable, type Container, type Registry } from 'injectkit';
import { McpToolHandlerMap } from '@maroonedsoftware/mcp';
import { registerActivityMcpCatalog, registerActivityMcpToolClasses } from './activity.mcp.js';
import { registerArtBreaksMcpCatalog, registerArtBreaksMcpToolClasses } from './art.breaks.mcp.js';
import { registerAuthenticationSessionsMcpCatalog, registerAuthenticationSessionsMcpToolClasses } from './authentication.sessions.mcp.js';
import { registerCatalogMcpCatalog, registerCatalogMcpToolClasses } from './catalog.mcp.js';
import { registerChartsMcpCatalog, registerChartsMcpToolClasses } from './charts.mcp.js';
import { registerClockMcpCatalog, registerClockMcpToolClasses } from './clock.mcp.js';
import { registerDirectorMcpCatalog, registerDirectorMcpToolClasses } from './director.mcp.js';
import { registerHistoryMcpCatalog, registerHistoryMcpToolClasses } from './history.mcp.js';
import { registerMessagingMcpCatalog, registerMessagingMcpToolClasses } from './messaging.mcp.js';
import { registerNarrationsMcpCatalog, registerNarrationsMcpToolClasses } from './narrations.mcp.js';
import { registerNewsMcpCatalog, registerNewsMcpToolClasses } from './news.mcp.js';
import { registerNowplayingMcpTools, registerNowplayingMcpCatalog, registerNowplayingMcpToolClasses } from './nowplaying.mcp.js';
import { registerPersonasAuditionsMcpCatalog, registerPersonasAuditionsMcpToolClasses } from './personas.auditions.mcp.js';
import { registerPersonasMcpCatalog, registerPersonasMcpToolClasses } from './personas.mcp.js';
import { registerPlaylistsMcpCatalog, registerPlaylistsMcpToolClasses } from './playlists.mcp.js';
import { registerPlayoutMcpTools, registerPlayoutMcpCatalog, registerPlayoutMcpToolClasses } from './playout.mcp.js';
import { registerPluginsMcpCatalog, registerPluginsMcpToolClasses } from './plugins.mcp.js';
import { registerPodcastsMcpCatalog, registerPodcastsMcpToolClasses } from './podcasts.mcp.js';
import { registerProductionsMcpCatalog, registerProductionsMcpToolClasses } from './productions.mcp.js';
import { registerRenderMcpCatalog, registerRenderMcpToolClasses } from './render.mcp.js';
import { registerRequestsMcpTools, registerRequestsMcpCatalog, registerRequestsMcpToolClasses } from './requests.mcp.js';
import { registerScheduleMcpTools, registerScheduleMcpCatalog, registerScheduleMcpToolClasses } from './schedule.mcp.js';
import { registerSettingsMcpCatalog, registerSettingsMcpToolClasses } from './settings.mcp.js';
import { registerStationMcpCatalog, registerStationMcpToolClasses } from './station.mcp.js';
import { registerStationPlaylistsMcpCatalog, registerStationPlaylistsMcpToolClasses } from './station.playlists.mcp.js';
import { registerStorageMcpCatalog, registerStorageMcpToolClasses } from './storage.mcp.js';
import { registerTopicsMcpCatalog, registerTopicsMcpToolClasses } from './topics.mcp.js';
import { registerTracesMcpCatalog, registerTracesMcpToolClasses } from './traces.mcp.js';

/**
 * Build the MCP tool map: the tools `tools/list` reports.
 *
 * Bind it to the `McpToolHandlerMap` token from a factory, which is what supplies the
 * `Container` needed to resolve each handler:
 *
 * ```ts
 * registry.register(McpToolHandlerMap).useFactory(registerMcpTools).asSingleton();
 * ```
 */
export function registerMcpTools(container: Container): McpToolHandlerMap {
    const map = new McpToolHandlerMap();
    registerNowplayingMcpTools(map, container);
    registerPlayoutMcpTools(map, container);
    registerRequestsMcpTools(map, container);
    registerScheduleMcpTools(map, container);
    return map;
}

/**
 * A handler for every operation a tool can serve, flagged `mcp:` or not, kept apart from the
 * listed tools. Its own token, since `McpToolHandlerMap` is bound to `registerMcpTools`.
 */
@Injectable()
export class McpToolCatalog extends McpToolHandlerMap {}

/**
 * Build the catalog. Nothing lists it: a meta tool (one that searches the API, say) looks a
 * handler up by name and calls it. Bind it from a factory, as `registerMcpTools` is bound:
 *
 * ```ts
 * registry.register(McpToolCatalog).useFactory(registerMcpCatalog).asSingleton();
 * ```
 */
export function registerMcpCatalog(container: Container): McpToolCatalog {
    const map = new McpToolCatalog();
    registerActivityMcpCatalog(map, container);
    registerArtBreaksMcpCatalog(map, container);
    registerAuthenticationSessionsMcpCatalog(map, container);
    registerCatalogMcpCatalog(map, container);
    registerChartsMcpCatalog(map, container);
    registerClockMcpCatalog(map, container);
    registerDirectorMcpCatalog(map, container);
    registerHistoryMcpCatalog(map, container);
    registerMessagingMcpCatalog(map, container);
    registerNarrationsMcpCatalog(map, container);
    registerNewsMcpCatalog(map, container);
    registerNowplayingMcpCatalog(map, container);
    registerPersonasAuditionsMcpCatalog(map, container);
    registerPersonasMcpCatalog(map, container);
    registerPlaylistsMcpCatalog(map, container);
    registerPlayoutMcpCatalog(map, container);
    registerPluginsMcpCatalog(map, container);
    registerPodcastsMcpCatalog(map, container);
    registerProductionsMcpCatalog(map, container);
    registerRenderMcpCatalog(map, container);
    registerRequestsMcpCatalog(map, container);
    registerScheduleMcpCatalog(map, container);
    registerSettingsMcpCatalog(map, container);
    registerStationMcpCatalog(map, container);
    registerStationPlaylistsMcpCatalog(map, container);
    registerStorageMcpCatalog(map, container);
    registerTopicsMcpCatalog(map, container);
    registerTracesMcpCatalog(map, container);
    return map;
}

/**
 * Register every generated tool class on the registry, so the tool maps can resolve them:
 *
 * ```ts
 * registerMcpToolClasses(registry);
 * ```
 */
export function registerMcpToolClasses(registry: Registry): void {
    registerActivityMcpToolClasses(registry);
    registerArtBreaksMcpToolClasses(registry);
    registerAuthenticationSessionsMcpToolClasses(registry);
    registerCatalogMcpToolClasses(registry);
    registerChartsMcpToolClasses(registry);
    registerClockMcpToolClasses(registry);
    registerDirectorMcpToolClasses(registry);
    registerHistoryMcpToolClasses(registry);
    registerMessagingMcpToolClasses(registry);
    registerNarrationsMcpToolClasses(registry);
    registerNewsMcpToolClasses(registry);
    registerNowplayingMcpToolClasses(registry);
    registerPersonasAuditionsMcpToolClasses(registry);
    registerPersonasMcpToolClasses(registry);
    registerPlaylistsMcpToolClasses(registry);
    registerPlayoutMcpToolClasses(registry);
    registerPluginsMcpToolClasses(registry);
    registerPodcastsMcpToolClasses(registry);
    registerProductionsMcpToolClasses(registry);
    registerRenderMcpToolClasses(registry);
    registerRequestsMcpToolClasses(registry);
    registerScheduleMcpToolClasses(registry);
    registerSettingsMcpToolClasses(registry);
    registerStationMcpToolClasses(registry);
    registerStationPlaylistsMcpToolClasses(registry);
    registerStorageMcpToolClasses(registry);
    registerTopicsMcpToolClasses(registry);
    registerTracesMcpToolClasses(registry);
}
