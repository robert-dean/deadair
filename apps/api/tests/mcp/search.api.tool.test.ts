// `search_api` over the real catalog, as a connected app calls it: an index filtered to what this
// grant may use, then one operation in full. The index has to stay small, since the whole point of the
// tool is that the API's size is not paid by every conversation.

import { describe, expect, it } from 'vitest';
import type { AuthenticationSession } from '@maroonedsoftware/authentication';
import type { McpToolContext } from '@maroonedsoftware/mcp';

import { registerMcpCatalog } from '../../src/mcp/mcp.tools.js';
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

type Index = { total: number; showing: number; operations: Array<{ name: string; needs: string; readOnly: boolean }>; next: string };

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
        const { body } = await search({}, VIEWER);
        const index = body as unknown as Index;

        expect(index.total).toBeGreaterThan(0);
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
});
