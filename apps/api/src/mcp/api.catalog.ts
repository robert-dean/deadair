import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { McpToolHandler } from '@maroonedsoftware/mcp';
import { delegatedGrants, type UserActor } from '#modules/permissions/authorization.context.js';
import { PLATFORM_NAMESPACE, rolesGrant } from '#modules/permissions/platform.roles.js';

/**
 * The station's operations as `search_api` shows them and `call_api` reaches them.
 *
 * Built from the generated catalog's own tool definitions, so there is no second description of the
 * API to drift from the contracts: the name, the description written for the model, the hints and the
 * operation's security all come from what ContractKit emitted.
 */

/**
 * Who may call an operation: anybody holding a grant, or somebody whose role AND grant allow `view` or
 * `manage`. Read from the definition's `_meta['contractkit/security']`, the policy the tool asserts.
 */
export type CatalogAccess = 'anyone' | 'view' | 'manage';

export interface CatalogEntry {
    name: string;
    /** The first sentence of the description, for the index. */
    summary: string;
    description: string;
    access: CatalogAccess;
    readOnly: boolean;
    destructive: boolean;
    idempotent: boolean;
    /** The argument names, top level and inside `body` and `query`, which the search also weighs. */
    fields: string[];
    definition: Tool;
}

/** The security meta key ContractKit writes on every generated tool. */
export const SECURITY_META = 'contractkit/security';

/**
 * What a tool's security asks of its caller. A policy this does not know is treated as `manage`, the
 * stricter tier, so a new policy hides an operation from a view grant rather than offering one it
 * would be refused; the catalog test fails on any policy outside the three, so it does not stay that
 * way unnoticed.
 */
export function accessOf(definition: Tool): CatalogAccess {
    const security = definition._meta?.[SECURITY_META];
    if (security === 'none') return 'anyone';
    const policy = (security as { policy?: unknown } | undefined)?.policy;
    if (policy === false) return 'anyone';
    if (policy === 'platform.view') return 'view';
    return 'manage';
}

/** Whether this caller can use an operation: their role must allow it, and so must their grant. */
export function mayUse(actor: UserActor, access: CatalogAccess): boolean {
    if (access === 'anyone') return true;
    const ceiling = delegatedGrants(actor);
    return rolesGrant(actor.platformRoles, PLATFORM_NAMESPACE, access) && (ceiling === undefined || ceiling.has(access));
}

const firstSentence = (text: string): string => {
    const end = text.search(/\.(\s|$)/);
    return end === -1 ? text : text.slice(0, end + 1);
};

type JsonObject = { properties?: Record<string, JsonObject> };

/** Argument names: every top-level property, and those inside `body` and `query`, which the args wrap. */
const fieldsOf = (schema: Tool['inputSchema']): string[] => {
    const top = (schema as JsonObject).properties ?? {};
    const nested = ['body', 'query'].flatMap(key => Object.keys(top[key]?.properties ?? {}));
    return [...Object.keys(top).filter(key => key !== 'body' && key !== 'query'), ...nested];
};

export function toCatalogEntry(definition: Tool): CatalogEntry {
    const description = definition.description ?? '';
    return {
        name: definition.name,
        summary: firstSentence(description),
        description,
        access: accessOf(definition),
        readOnly: definition.annotations?.readOnlyHint === true,
        destructive: definition.annotations?.destructiveHint === true,
        idempotent: definition.annotations?.idempotentHint === true,
        fields: fieldsOf(definition.inputSchema),
        definition,
    };
}

export function catalogEntries(tools: Iterable<McpToolHandler>): CatalogEntry[] {
    return [...tools].map(tool => toCatalogEntry(tool.definition)).sort((a, b) => a.name.localeCompare(b.name));
}

/** The most entries one search answers with; the total says how many more there were. */
export const SEARCH_LIMIT = 25;

const words = (text: string): string[] =>
    text
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter(word => word.length > 1);

/**
 * How well an entry answers a query: a word in the name counts three, in the description two, in an
 * argument name one, and a read edges ahead of a write that scores the same, since a model searching
 * usually wants to look before it acts.
 */
export function scoreEntry(entry: CatalogEntry, query: ReadonlyArray<string>): number {
    const name = entry.name.toLowerCase();
    const description = entry.description.toLowerCase();
    const fields = entry.fields.join(' ').toLowerCase();
    let score = 0;
    for (const word of query) {
        if (name.includes(word)) score += 3;
        if (description.includes(word)) score += 2;
        if (fields.includes(word)) score += 1;
    }
    return score > 0 && entry.readOnly ? score + 0.5 : score;
}

export interface SearchOptions {
    query?: string;
    readOnly?: boolean;
    limit?: number;
}

/** The best matches for a query, or every entry by name when there is none, with the total before the limit. */
export function searchCatalog(entries: ReadonlyArray<CatalogEntry>, options: SearchOptions): { total: number; results: CatalogEntry[] } {
    const query = words(options.query ?? '');
    const eligible = options.readOnly === undefined ? entries : entries.filter(entry => entry.readOnly === options.readOnly);
    const ranked =
        query.length === 0
            ? [...eligible]
            : eligible
                  .map(entry => ({ entry, score: scoreEntry(entry, query) }))
                  .filter(scored => scored.score > 0)
                  .sort((a, b) => b.score - a.score || a.entry.name.localeCompare(b.entry.name))
                  .map(scored => scored.entry);
    return { total: ranked.length, results: ranked.slice(0, options.limit ?? SEARCH_LIMIT) };
}
