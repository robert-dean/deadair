import { Container, Registry } from 'injectkit';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { ServerKitModule } from '@maroonedsoftware/koa';
import { McpConfig, McpDispatcher, McpResourceHandlerMap, McpServerFactory, McpSessionRegistry, McpToolHandlerMap } from '@maroonedsoftware/mcp';
import { buildVersion } from '#modules/shared/build.revision.js';

/** What an MCP client sees as `serverInfo.name` during `initialize`. */
export const MCP_SERVER_NAME = 'deadair';

/**
 * The station's MCP endpoint, `POST /api/mcp`, with no tools yet.
 *
 * What it proves is the way in: an MCP client such as a Claude connector finds the station's OAuth
 * authorization server from this endpoint's 401, gets somebody signed in to approve it, and comes
 * back with a token that the `oauth.grant` policy accepts, then `initialize` and `tools/list` answer.
 * The tools are a later piece of work, and will come from contracts flagged `mcp: true`, which
 * ContractKit turns into handlers for the map below and a router in the shape `routes/mcp.router.ts`
 * has now.
 *
 * **Stateless**: each POST is one JSON-RPC exchange, so there is no session map to keep. The
 * shared-token authentication the MCP package offers is NOT registered: a caller here is an OAuth
 * grant's session, authenticated by the station's own JWT chain like any other.
 *
 * Last in `modules.ts`: nothing resolves it, and once there are tools it will compose everything
 * above it. `start` resolves the dispatcher, so a tool whose own dependencies cannot be built stops
 * the boot rather than failing the first call.
 */
export const McpModule: ServerKitModule = {
    name: 'Mcp',
    setup: async (registry: Registry, config: AppConfig) => {
        registry
            .register(McpConfig)
            .useFactory((): McpConfig => ({ serverName: MCP_SERVER_NAME, version: buildVersion(config) ?? 'dev', sessionMode: 'stateless' }))
            .asSingleton();
        registry.register(McpToolHandlerMap).useInstance(new McpToolHandlerMap());
        // Empty, and registered anyway: the server factory takes both maps, and advertises only what
        // a non-empty one backs.
        registry.register(McpResourceHandlerMap).useInstance(new McpResourceHandlerMap());
        registry.register(McpServerFactory).useClass(McpServerFactory).asSingleton();
        // Stateless never reaches it, but the dispatcher takes it unconditionally.
        registry.register(McpSessionRegistry).useClass(McpSessionRegistry).asSingleton();
        registry.register(McpDispatcher).useClass(McpDispatcher).asSingleton();
    },
    start: async (container: Container) => {
        container.get(McpDispatcher);
    },
};
