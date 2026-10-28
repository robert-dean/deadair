// What a connected model is told about the station. The text names operations so the model can hand
// each name straight to `search_api`, which makes a renamed operation a quiet lie in every conversation:
// these pin every name it mentions to one that exists, and the `help` tool to the same text.

import { describe, expect, it } from 'vitest';
import { McpToolHandlerMap, type McpToolContext } from '@maroonedsoftware/mcp';

import { McpToolCatalog, registerMcpCatalog } from '../../src/mcp/mcp.tools.js';
import { HELP_TOOL, STATION_INSTRUCTIONS, stationHelpTool } from '../../src/mcp/station.instructions.js';
import { CALL_API_TOOL } from '../../src/mcp/call.api.tool.js';
import { SEARCH_API_TOOL } from '../../src/mcp/search.api.tool.js';
import { WHOAMI_TOOL } from '../../src/mcp/whoami.tool.js';

/** The generated tools resolve everything per call, so each is built with nothing. */
const catalog: McpToolCatalog = registerMcpCatalog({ get: (Tool: new () => unknown) => new Tool() } as never);
const known = new Set([...catalog.keys(), WHOAMI_TOOL, SEARCH_API_TOOL, CALL_API_TOOL]);

/** Every snake_case word in the text: an operation name, since nothing else in it is written that way. */
const namesIn = (text: string): string[] => [...new Set(text.match(/\b[a-z]+(?:_[a-z]+)+\b/g) ?? [])];

describe('the station instructions', () => {
    it('name only operations that exist', () => {
        const named = namesIn(STATION_INSTRUCTIONS);
        expect(named.length).toBeGreaterThan(40);
        expect(named.filter(name => !known.has(name))).toEqual([]);
    });

    it('point at the operations behind each recent feature', () => {
        for (const name of [
            'arm_the_live_input',
            'list_recordings',
            'create_break_kind',
            'create_clock_band',
            'request_own_show_episode',
            'keep_the_station_quiet',
            'write_a_running_order_break_again',
            'suspend_artist',
            'create_pronunciation',
        ]) {
            expect(STATION_INSTRUCTIONS).toContain(name);
        }
    });

    it('stay short enough to sit in every conversation', () => {
        expect(STATION_INSTRUCTIONS.length).toBeLessThan(6000);
    });

    it('open the help tool’s answer, from a tool that says it only reads', async () => {
        const tools = new McpToolHandlerMap();
        const help = stationHelpTool(tools);
        tools.set(HELP_TOOL, help);
        expect(help.definition.annotations?.readOnlyHint).toBe(true);
        const result = await help.handle({}, {} as McpToolContext);
        const text = result.content.map(part => (part.type === 'text' ? part.text : '')).join('\n');
        expect(text.startsWith(STATION_INSTRUCTIONS)).toBe(true);
    });
});
