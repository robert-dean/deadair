// What `tools/list` reports, built through `McpModule`'s own factories. Every listed tool is paid for
// in every conversation a connected app has, so the set is pinned here: adding one is a decision this
// test makes somebody look at, and anything else is reached through search_api and call_api.

import { describe, expect, it } from 'vitest';

import { buildMcpCatalog, buildMcpTools } from '../../../src/modules/mcp/mcp.module.js';
import { CallApiTool } from '../../../src/mcp/call.api.tool.js';
import { McpToolCatalog } from '../../../src/mcp/mcp.tools.js';
import { SearchApiTool } from '../../../src/mcp/search.api.tool.js';
import { WhoAmITool } from '../../../src/mcp/whoami.tool.js';

/** The container the module's factories resolve from, answering each tool the way DI would. */
const container = (() => {
    const resolve = (Tool: new (...deps: unknown[]) => unknown): unknown => {
        if (Tool === WhoAmITool) return new WhoAmITool({ get: (_key: string, fallback: unknown) => fallback } as never);
        if (Tool === McpToolCatalog) return catalog;
        if (Tool === SearchApiTool) return new SearchApiTool(catalog);
        if (Tool === CallApiTool) return new CallApiTool(catalog);
        return new Tool();
    };
    const catalog = buildMcpCatalog({ get: resolve } as never);
    return { get: resolve } as never;
})();

describe('the listed MCP tools', () => {
    const tools = [...buildMcpTools(container).values()].map(tool => tool.definition);

    it('are the everyday operations, whoami, and the two that reach the rest', () => {
        expect(tools.map(tool => tool.name).sort()).toEqual([
            'call_api',
            'create_request',
            'get_now_playing',
            'get_playout_status',
            'list_my_requests',
            'read_current_slot',
            'read_timetable',
            'search_api',
            'search_requestable_records',
            'skip_the_current_item',
            'whoami',
        ]);
    });

    it('each carry a description written for the model, not the route’s one-line comment', () => {
        for (const tool of tools) expect(tool.description!.length, tool.name).toBeGreaterThan(80);
    });

    it('say which of them change something', () => {
        const writes = tools.filter(tool => tool.annotations?.readOnlyHint !== true).map(tool => tool.name);
        expect(writes.sort()).toEqual(['call_api', 'create_request', 'skip_the_current_item']);
    });
});
