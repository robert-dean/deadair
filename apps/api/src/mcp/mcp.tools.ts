import { type Container, type Registry } from 'injectkit';
import { McpToolHandlerMap } from '@maroonedsoftware/mcp';
import { registerNowplayingMcpTools, registerNowplayingMcpToolClasses } from './nowplaying.mcp.js';
import { registerPlayoutMcpTools, registerPlayoutMcpToolClasses } from './playout.mcp.js';

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
    registerNowplayingMcpToolClasses(registry);
    registerPlayoutMcpToolClasses(registry);
}
