// `search_api` over the real catalog, as a connected app calls it: an index filtered to what this
// grant may use, then one operation in full. The index has to stay small, since the whole point of the
// tool is that the API's size is not paid by every conversation.

import { describe, expect, it } from 'vitest';
import type { AuthenticationSession } from '@maroonedsoftware/authentication';
import type { McpToolContext } from '@maroonedsoftware/mcp';

import { AREA_META } from '../../src/mcp/api.catalog.js';
import { McpToolCatalog, registerMcpCatalog } from '../../src/mcp/mcp.tools.js';
import { registerPersonasMcpCatalog } from '../../src/mcp/personas.mcp.js';
import { registerPlaylistsMcpCatalog } from '../../src/mcp/playlists.mcp.js';
import { registerPlayoutMcpCatalog } from '../../src/mcp/playout.mcp.js';
import { SEARCH_API_TOOL, SearchApiTool } from '../../src/mcp/search.api.tool.js';
import { AuthorizationContext, type UserActor } from '../../src/modules/permissions/authorization.context.js';

const tool = new SearchApiTool(registerMcpCatalog({ get: (Tool: new () => unknown) => new Tool() } as never));

const contextFor = (roles: Array<'admin' | 'listener'>, grants: Array<'view' | 'manage'>): McpToolContext => {
    const actor: UserActor = {
        kind: 'user',
        sessionToken: 's',
        actorId: 'u-1',
        factors: [],
        platformRoles: new Set(roles),
        grant: { id: 'g-1', clientId: 'dyn_1', grants: new Set(grants) },
    };
    return {
        requestId: 'req-1',
        logger: { debug() {}, info() {}, warn() {}, error() {} } as never,
        toolName: SEARCH_API_TOOL,
        authenticationSession: { subject: 'u-1', sessionToken: 's', claims: {}, factors: [] } as unknown as AuthenticationSession,
        container: { get: (token: unknown) => (token === AuthorizationContext ? new AuthorizationContext(actor) : undefined) } as never,
    };
};

const ADMIN = contextFor(['admin'], ['view', 'manage']);
const VIEWER = contextFor(['admin'], ['view']);

type Index = { total: number; showing: number; operations: Array<{ name: string; area?: string; needs: string; readOnly: boolean }>; next: string };

const search = async (args: Record<string, unknown>, context = ADMIN) => {
    const result = await tool.handle(args, context);
    return { result, body: result.structuredContent as Record<string, unknown> };
};

describe('search_api', () => {
    it('is itself read-only', () => {
        expect(tool.definition.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false });
    });

    it('answers a small index for a query', async () => {
        const { result, body } = await search({ query: 'skip' });
        const index = body as unknown as Index;

        expect(index.operations.map(operation => operation.name)).toContain('skip_the_current_item');
        expect(index.next).toMatch(/call_api/);
        // A whole page of the index costs a few thousand characters, not the API.
        const everything = await search({});
        expect((everything.result.content[0] as { text: string }).text.length).toBeLessThan(8000);
        expect(result.isError).toBeUndefined();
    });

    it('offers a view grant nothing it would be refused', async () => {
        // With nothing asked, the answer is the map of areas once the catalog carries them, and the
        // index by name before that; either way there is something a view grant may use.
        const { body } = await search({}, VIEWER);
        expect(Array.isArray(body.areas) ? (body.areas as unknown[]).length : (body as unknown as Index).total).toBeGreaterThan(0);
        const all = await search({ query: 'skip start stop playout' }, VIEWER);
        const names = (all.body as unknown as Index).operations.map(operation => operation.name);
        expect(names).toContain('get_playout_status');
        expect(names).not.toContain('skip_the_current_item');
        expect((all.body as unknown as Index).operations.every(operation => operation.needs !== 'manage')).toBe(true);
    });

    it('answers one operation in full by name, with how to call it', async () => {
        const { body } = await search({ name: 'list_albums' });

        expect(body).toMatchObject({ name: 'list_albums', needs: 'view', readOnly: true });
        expect(body.arguments).toMatchObject({ type: 'object' });
        expect(body.returns).toMatchObject({ type: 'object' });
        expect(body.howToCall).toMatch(/arguments\.query/);
    });

    it('refuses a name this grant may not use as though it were not there', async () => {
        const { result } = await search({ name: 'skip_the_current_item' }, VIEWER);

        expect(result.isError).toBe(true);
        expect((result.content[0] as { text: string }).text).toMatch(/No operation this app may use/);
    });

    it('refuses a name that is no operation', async () => {
        expect((await search({ name: 'launch_the_rockets' })).result.isError).toBe(true);
    });

    it('suggests the operation a near miss meant', async () => {
        const { result, body } = await search({ name: 'list_album' });

        expect(result.isError).toBe(true);
        expect(body.suggestions).toContain('list_albums');
        expect((result.content[0] as { text: string }).text).toMatch(/Did you mean .*list_albums/);
    });

    it('never suggests what this grant would be refused', async () => {
        const { body } = await search({ name: 'skip_the_current_itm' }, VIEWER);

        expect(body.suggestions).not.toContain('skip_the_current_item');
    });
});

// The map of areas, over a catalog stamped as ContractKit stamps it (`_meta['contractkit/area']`), one
// contract file per area. Built from the per-file registrations so it is the real operations, not a fake.
describe('search_api by area', () => {
    const files: Array<[string, (map: McpToolCatalog, container: never) => void]> = [
        ['playlists', registerPlaylistsMcpCatalog],
        ['playout', registerPlayoutMcpCatalog],
        ['personas', registerPersonasMcpCatalog],
    ];
    const catalog = new McpToolCatalog();
    for (const [area, register] of files) {
        const part = new McpToolCatalog();
        register(part, { get: (Tool: new () => unknown) => new Tool() } as never);
        for (const [name, handler] of part) {
            const definition = { ...handler.definition, _meta: { ...handler.definition._meta, [AREA_META]: area } };
            catalog.set(name, { definition, handle: handler.handle.bind(handler) });
        }
    }
    const areaTool = new SearchApiTool(catalog);
    const find = async (args: Record<string, unknown>, context = ADMIN) => {
        const result = await areaTool.handle(args, context);
        return { result, body: result.structuredContent as Record<string, unknown> };
    };
    type Areas = { areas: Array<{ area: string; operations: number; reads: number }>; next: string };

    it('answers the map of areas when asked for nothing', async () => {
        const { body } = await find({});
        const { areas, next } = body as unknown as Areas;

        expect(areas.map(area => area.area)).toEqual(['personas', 'playlists', 'playout']);
        expect(areas.reduce((sum, area) => sum + area.operations, 0)).toBe(catalog.size);
        expect(areas.every(area => area.reads <= area.operations)).toBe(true);
        expect(next).toMatch(/area/);
    });

    it("lists one area's operations, and only those", async () => {
        const { body } = await find({ area: 'playout' });
        const index = body as unknown as Index;

        expect(index.total).toBeGreaterThan(0);
        expect(index.operations.map(operation => operation.name)).toContain('skip_the_current_item');
        expect(index.operations.every(operation => operation.area === 'playout')).toBe(true);
    });

    it('narrows an area with a query', async () => {
        const { body } = await find({ area: 'playout', query: 'skip' });

        expect((body as unknown as Index).operations[0]!.name).toBe('skip_the_current_item');
    });

    it('counts and lists only what this grant may use', async () => {
        const viewer = (await find({}, VIEWER)).body as unknown as Areas;
        const admin = (await find({}, ADMIN)).body as unknown as Areas;
        const playout = (areas: Areas) => areas.areas.find(area => area.area === 'playout')!;

        expect(playout(viewer).operations).toBeLessThan(playout(admin).operations);
        expect(playout(viewer).operations).toBe(playout(viewer).reads);
        const listed = (await find({ area: 'playout' }, VIEWER)).body as unknown as Index;
        expect(listed.operations.map(operation => operation.name)).not.toContain('skip_the_current_item');
    });

    it('suggests the area a misspelt one meant', async () => {
        const { result, body } = await find({ area: 'playlist' });

        expect(result.isError).toBe(true);
        expect(body.suggestions).toContain('playlists');
        expect((result.content[0] as { text: string }).text).toMatch(/Did you mean playlists/);
    });
});
