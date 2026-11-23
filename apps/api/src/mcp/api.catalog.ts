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
    /** The contract's area (`playlists`, `director`), from `_meta['contractkit/area']`; absent when the generator wrote none. */
    area?: string;
    definition: Tool;
}

/** The security meta key ContractKit writes on every generated tool. */
export const SECURITY_META = 'contractkit/security';

/** The area meta key ContractKit writes on a generated tool whose contract names an `area`. */
export const AREA_META = 'contractkit/area';

/**
 * What a tool's security asks of its caller. A policy this does not know is treated as `manage`, the
 * stricter tier, so a new policy hides an operation from a view grant rather than offering one it
 * would be refused; the catalog test fails on any policy outside the ones named here, so it does not stay that
 * way unnoticed.
 */
export function accessOf(definition: Tool): CatalogAccess {
    const security = definition._meta?.[SECURITY_META];
    if (security === 'none') return 'anyone';
    const policy = (security as { policy?: unknown } | undefined)?.policy;
    if (policy === false) return 'anyone';
    // `requests.ask` is `platform.view` plus a party guest, and a guest never reaches the MCP endpoint
    // (`oauth.grant` admits a connected app's session only), so to a caller here it IS view.
    if (policy === 'platform.view' || policy === 'requests.ask') return 'view';
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
    const area = definition._meta?.[AREA_META];
    return {
        ...(typeof area === 'string' && area !== '' ? { area } : {}),
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
    /** Only operations in this area. */
    area?: string;
    limit?: number;
}

/** One area as the map of the API shows it: how many operations it holds, and how many of those only read. */
export interface CatalogArea {
    area: string;
    operations: number;
    reads: number;
}

/**
 * The map of the API: every area the given entries fall in, with its counts, by name. What a model is
 * shown when it searches with nothing, so it can see how the station is organised before it guesses
 * words, rather than the first 25 of two hundred operations in alphabetical order. Empty when no entry
 * carries an area, which is what a catalog generated before areas were reported looks like.
 */
export function catalogAreas(entries: ReadonlyArray<CatalogEntry>): CatalogArea[] {
    const areas = new Map<string, CatalogArea>();
    for (const entry of entries) {
        if (entry.area === undefined) continue;
        const area = areas.get(entry.area) ?? { area: entry.area, operations: 0, reads: 0 };
        area.operations += 1;
        if (entry.readOnly) area.reads += 1;
        areas.set(entry.area, area);
    }
    return [...areas.values()].sort((a, b) => a.area.localeCompare(b.area));
}

/** The areas a name that is none most likely meant, closest first, for a mistyped `area`. */
export function closestAreas(areas: ReadonlyArray<CatalogArea>, name: string, limit = SUGGESTION_LIMIT): string[] {
    const typed = name.toLowerCase();
    return areas
        .map(area => ({
            area: area.area,
            distance: editDistance(typed, area.area),
            contains: area.area.includes(typed) || typed.includes(area.area),
        }))
        .filter(scored => scored.contains || scored.distance <= Math.max(2, Math.floor(typed.length / 3)))
        .sort((a, b) => Number(b.contains) - Number(a.contains) || a.distance - b.distance || a.area.localeCompare(b.area))
        .slice(0, limit)
        .map(scored => scored.area);
}

/** The most names a miss suggests. */
export const SUGGESTION_LIMIT = 3;

/** Words in an operation name that say nothing about which one it is. */
const FILLER = new Set(['the', 'an', 'to', 'of', 'for', 'on', 'in', 'and', 'or', 'by', 'from', 'with', 'my', 'it', 'its', 'this', 'that', 'one']);

/**
 * How much a name's closeness counts against shared words. A search word scores up to six (name and
 * description), and an operation like `list_album_tracks` shares every word of `list_album` and then
 * some through its description and arguments, so closeness has to be able to outweigh a couple of those.
 */
const CLOSENESS_WEIGHT = 10;

/** How many single-character edits turn one string into the other. */
export function editDistance(a: string, b: string): number {
    let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i++) {
        const current = [i];
        for (let j = 1; j <= b.length; j++) {
            current[j] = Math.min(previous[j]! + 1, current[j - 1]! + 1, previous[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
        }
        previous = current;
    }
    return previous[b.length]!;
}

/**
 * The operations a name that matched none most likely meant, best first. Two signals, because each
 * misses what the other catches: the name's words scored as a search would score them, so
 * `skip_current_item` finds `skip_the_current_item`, and how close the whole name is, so `list_album`
 * ranks `list_albums` above `list_album_tracks` (which shares as many words) and `lsit_albums`, which
 * shares none, is still found. Filler words are dropped first, or `launch_the_rockets` would suggest
 * every operation whose description says "the". Empty when nothing is near.
 */
export function closestNames(entries: ReadonlyArray<CatalogEntry>, name: string, limit = SUGGESTION_LIMIT): string[] {
    const typed = name.toLowerCase();
    const query = words(typed).filter(word => !FILLER.has(word));
    return entries
        .map(entry => {
            const distance = editDistance(typed, entry.name);
            const closeness = 1 - distance / Math.max(typed.length, entry.name.length, 1);
            const near = distance <= Math.max(2, Math.floor(typed.length / 5));
            const shared = query.length === 0 ? 0 : scoreEntry(entry, query);
            return { name: entry.name, score: shared + CLOSENESS_WEIGHT * closeness, keep: shared > 0 || near };
        })
        .filter(scored => scored.keep)
        .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
        .slice(0, limit)
        .map(scored => scored.name);
}

/** "Did you mean ...?", or nothing when there is nothing to suggest. */
export function didYouMean(suggestions: ReadonlyArray<string>): string {
    return suggestions.length === 0 ? '' : ` Did you mean ${suggestions.join(', ')}?`;
}

/** The best matches for a query, or every entry by name when there is none, with the total before the limit. */
export function searchCatalog(entries: ReadonlyArray<CatalogEntry>, options: SearchOptions): { total: number; results: CatalogEntry[] } {
    const query = words(options.query ?? '');
    const eligible = entries.filter(
        entry =>
            (options.readOnly === undefined || entry.readOnly === options.readOnly) && (options.area === undefined || entry.area === options.area),
    );
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
