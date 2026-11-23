import { Injectable } from 'injectkit';
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';
import { requireMcpAuthenticationSession, type McpToolContext, type McpToolHandler } from '@maroonedsoftware/mcp';
import { AuthorizationContext } from '#modules/permissions/authorization.context.js';
import { McpToolCatalog } from './mcp.tools.js';
import {
    catalogAreas,
    catalogEntries,
    closestAreas,
    closestNames,
    didYouMean,
    mayUse,
    searchCatalog,
    SEARCH_LIMIT,
    type CatalogEntry,
} from './api.catalog.js';

export const SEARCH_API_TOOL = 'search_api';

/** How `call_api`'s `arguments` are shaped, since the generated schemas wrap a request's parts. */
export const ARGUMENT_SHAPE =
    'Pass these to call_api as { name, arguments }. Path parameters are top-level keys of arguments, a request body goes under arguments.body, and query parameters under arguments.query.';

/**
 * Finds any station operation, as the listed tools cannot: there are around two hundred, and listing
 * them all would cost every conversation the whole API before it asked a thing.
 *
 * Three modes. With nothing, it answers the map: every area the caller can use something in, with
 * how many operations each holds, so a model sees how the station is organised before it guesses
 * words. With a `query` or an `area` it answers a compact, scored index of operations, filtered to what
 * this caller may actually use, so a view grant is never offered an operation it would be refused. With
 * a `name` it answers that one operation in full, schemas included, ready for `call_api`.
 *
 * The map needs the area ContractKit reports in each tool's `_meta`. A catalog generated without it
 * has no areas to show, and searching with nothing then lists operations by name, as it always did.
 */
@Injectable()
export class SearchApiTool implements McpToolHandler {
    readonly definition: Tool = {
        name: SEARCH_API_TOOL,
        title: 'Search the station API',
        description: `Finds operations on the station beyond the listed tools: the catalog, the running order, schedules, personas, playlists, requests, plugins and more. Call it with nothing to see the station's areas and how many operations each holds, with an area or a query (words like "playlist", "skip" or "persona story") to get a short index of matching operations this app may use, then again with the name of the one you want to get its arguments. Call it with call_api afterwards. Answers at most ${SEARCH_LIMIT} operations at a time, with the total.`,
        inputSchema: {
            type: 'object',
            properties: {
                query: {
                    type: 'string',
                    description: 'Words to match against operation names, descriptions and argument names. Omit to list everything.',
                },
                area: {
                    type: 'string',
                    description: 'One area from the map (search with nothing to see them), to list its operations. May be combined with query.',
                },
                readOnly: { type: 'boolean', description: 'true for operations that only read, false for those that change something.' },
                name: { type: 'string', description: 'One operation name from the index, to get its full description and argument schema.' },
            },
        },
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    };

    private entries?: CatalogEntry[];

    constructor(private readonly catalog: McpToolCatalog) {}

    async handle(args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        requireMcpAuthenticationSession(context);
        if (!context.container) throw new Error(`MCP tool '${context.toolName}' needs the request container.`);
        const actor = context.container.get(AuthorizationContext).requireUser();
        const usable = this.allEntries().filter(entry => mayUse(actor, entry.access));

        if (typeof args.name === 'string') {
            const entry = usable.find(candidate => candidate.name === args.name);
            if (!entry) {
                const suggestions = closestNames(usable, args.name);
                return failure(
                    `No operation this app may use is called ${args.name}.${didYouMean(suggestions)} Search without a name to see what is available.`,
                    suggestions,
                );
            }
            return answer(detailOf(entry));
        }

        const query = typeof args.query === 'string' && args.query.trim() !== '' ? args.query : undefined;
        const area = typeof args.area === 'string' && args.area.trim() !== '' ? args.area.trim().toLowerCase() : undefined;
        const readOnly = typeof args.readOnly === 'boolean' ? args.readOnly : undefined;
        const areas = catalogAreas(readOnly === undefined ? usable : usable.filter(entry => entry.readOnly === readOnly));

        if (area !== undefined && !areas.some(known => known.area === area)) {
            const suggestions = closestAreas(areas, area);
            return failure(
                `There is no area called ${area} this app may use anything in.${didYouMean(suggestions)} Search with nothing to see the areas.`,
                suggestions,
            );
        }
        if (query === undefined && area === undefined && areas.length > 0) {
            return answer({
                areas,
                next: 'Call search_api with one area to list its operations, or with a query to search them all.',
            });
        }

        const { total, results } = searchCatalog(usable, { query, area, readOnly });
        return answer({
            total,
            showing: results.length,
            operations: results.map(entry => ({
                name: entry.name,
                summary: entry.summary,
                ...(entry.area === undefined ? {} : { area: entry.area }),
                needs: entry.access,
                readOnly: entry.readOnly,
                destructive: entry.destructive,
            })),
            next:
                total === 0
                    ? 'Nothing matched. Try other words, or no query to list everything.'
                    : 'Call search_api with one name to get its arguments, then call_api to run it.',
        });
    }

    /** Built on first use rather than at boot: the definitions never change, and nothing needs them before a search. */
    private allEntries(): CatalogEntry[] {
        this.entries ??= catalogEntries(this.catalog.values());
        return this.entries;
    }
}

function detailOf(entry: CatalogEntry): Record<string, unknown> {
    return {
        name: entry.name,
        description: entry.description,
        needs: entry.access,
        readOnly: entry.readOnly,
        destructive: entry.destructive,
        idempotent: entry.idempotent,
        arguments: entry.definition.inputSchema,
        ...(entry.definition.outputSchema ? { returns: entry.definition.outputSchema } : {}),
        howToCall: ARGUMENT_SHAPE,
    };
}

const answer = (result: Record<string, unknown>): CallToolResult => ({
    content: [{ type: 'text', text: JSON.stringify(result) }],
    structuredContent: result,
});

const failure = (text: string, suggestions: ReadonlyArray<string>): CallToolResult => ({
    isError: true,
    content: [{ type: 'text', text }],
    structuredContent: { suggestions: [...suggestions] },
});
