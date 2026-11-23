// `call_api` over the real generated catalog, explained as `McpModule` explains it, with the station's
// own platform policies deciding for the caller. What it proves is that an operation reached through
// the catalog is refused, validated and answered exactly as a listed tool is, and that a long answer
// comes back as whole records with a count rather than as the whole of a table.

import { describe, expect, it, vi } from 'vitest';
import { DateTime } from 'luxon';
import type { AuthenticationSession } from '@maroonedsoftware/authentication';
import { httpError } from '@maroonedsoftware/errors';
import { explainToolErrors, type McpToolContext } from '@maroonedsoftware/mcp';
import { PolicyService } from '@maroonedsoftware/policies';

import { BATCH_LIMIT, CallApiTool, RESULT_CHAR_LIMIT, shape } from '../../src/mcp/call.api.tool.js';
import { McpToolCatalog, registerMcpCatalog } from '../../src/mcp/mcp.tools.js';
import { AuthorizationContext, type UserActor } from '../../src/modules/permissions/authorization.context.js';
import { PlatformManagePolicy, PlatformViewPolicy, type RequirePolicyContext } from '../../src/modules/policy/policy.mappings.js';
import type { ServerPolicyEnvelope } from '../../src/modules/policy/policy.envelope.js';

const ALBUM = '8a4c1f0e-5b2d-4e6f-9a1b-2c3d4e5f6a7b';

const catalog = new McpToolCatalog();
for (const [name, handler] of explainToolErrors(registerMcpCatalog({ get: (Tool: new () => unknown) => new Tool() } as never)))
    catalog.set(name, handler);
const tool = new CallApiTool(catalog);

/** The services the operations under test reach, by class name, as the request's container resolves them. */
const services = () => ({
    AlbumsService: { listAlbums: vi.fn(async () => ({ items: [], total: 0 })), getAlbum: vi.fn(async (id: string) => ({ id, title: 'Low' })) },
    PlayoutService: { skip: vi.fn(async () => ({ skipped: true })) },
    PluginsService: { listPlugins: vi.fn(async () => [{ id: 'deadair.lastfm', name: 'Last.fm', enabled: true }]) },
});

/** The station's own two platform policies, deciding for this actor, refusing as `requirePolicy` does. */
const policiesFor = (actor: UserActor) => ({
    assert: async (name: string) => {
        const policy = name === 'platform.manage' ? new PlatformManagePolicy() : new PlatformViewPolicy();
        const result = await policy.evaluate({} as RequirePolicyContext, { actor, now: DateTime.utc() } as ServerPolicyEnvelope);
        if (!result.allowed) throw httpError(403).withHeaders((result as { headers?: Record<string, string> }).headers ?? {});
    },
});

const contextFor = (grants: Array<'view' | 'manage'>, stubs = services()) => {
    const actor: UserActor = {
        kind: 'user',
        sessionToken: 's',
        actorId: 'u-1',
        factors: [],
        platformRoles: new Set(['admin']),
        grant: { id: 'g-1', clientId: 'dyn_1', grants: new Set(grants) },
    };
    const info = vi.fn();
    const scoped = (token: { name?: string }): unknown => {
        if (token === PolicyService) return policiesFor(actor);
        if (token === AuthorizationContext) return new AuthorizationContext(actor);
        return (stubs as Record<string, unknown>)[token.name ?? ''];
    };
    const context: McpToolContext = {
        requestId: 'req-1',
        logger: { debug() {}, info, warn() {}, error() {} } as never,
        toolName: 'call_api',
        authenticationSession: {
            subject: 'u-1',
            sessionToken: 's',
            claims: { oauth: { clientId: 'dyn_1', resource: 'r', scope: ['mcp'], grantId: 'g-1' } },
            factors: [],
        } as unknown as AuthenticationSession,
        container: { get: scoped } as never,
    };
    return { context, info, stubs };
};

const text = (result: { content: unknown[] }) => (result.content[0] as { text: string }).text;

describe('call_api', () => {
    it('says it may change things, so a client asks before it runs', () => {
        expect(tool.definition.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true });
    });

    it('runs an operation as the caller, with an omitted query parsed as the route would parse it', async () => {
        const { context, stubs } = contextFor(['view']);

        const result = await tool.handle({ name: 'list_albums' }, context);

        expect(result.isError).toBeUndefined();
        expect(result.structuredContent).toEqual({ items: [], total: 0 });
        expect(stubs.AlbumsService.listAlbums).toHaveBeenCalledWith(expect.objectContaining({ page: expect.any(Number) }));
    });

    it('tells the model a view grant may not manage, naming the scope, rather than failing the protocol', async () => {
        const { context, stubs } = contextFor(['view']);

        const result = await tool.handle({ name: 'skip_the_current_item' }, context);

        expect(result.isError).toBe(true);
        expect(text(result)).toBe('This caller is not allowed to do that. It needs the `manage` scope.');
        expect(stubs.PlayoutService.skip).not.toHaveBeenCalled();
    });

    it('runs a manage operation for a grant that may manage', async () => {
        const { context, stubs } = contextFor(['view', 'manage']);

        expect((await tool.handle({ name: 'skip_the_current_item' }, context)).isError).toBeUndefined();
        expect(stubs.PlayoutService.skip).toHaveBeenCalledOnce();
    });

    it('lists the argument that was wrong', async () => {
        const { context } = contextFor(['view']);

        const result = await tool.handle({ name: 'get_album', arguments: { id: 'not-an-album' } }, context);

        expect(result.isError).toBe(true);
        expect(text(result)).toMatch(/^The arguments were not valid:\n- id: /);
    });

    it('answers a list as { items }, which is all structured content may be', async () => {
        const { context } = contextFor(['view']);

        const result = await tool.handle({ name: 'list_plugins' }, context);

        expect(result.structuredContent).toEqual({ items: [{ id: 'deadair.lastfm', name: 'Last.fm', enabled: true }] });
    });

    it('keeps only the fields asked for', async () => {
        const { context } = contextFor(['view']);

        const result = await tool.handle({ name: 'list_plugins', fields: ['id'] }, context);

        expect(result.structuredContent).toEqual({ items: [{ id: 'deadair.lastfm' }] });
    });

    it('refuses an operation that is not in the catalog, excluded ones included', async () => {
        const { context } = contextFor(['view', 'manage']);

        for (const name of ['launch_the_rockets', 'create_api_key', 'update_settings']) {
            const result = await tool.handle({ name }, context);
            expect(result.isError, name).toBe(true);
            expect(text(result)).toMatch(/Use search_api/);
        }
    });

    it('suggests the closest names this grant may use when a name is wrong', async () => {
        const viewer = contextFor(['view']).context;
        const manager = contextFor(['view', 'manage']).context;

        const near = await tool.handle({ name: 'list_album' }, viewer);
        expect(near.isError).toBe(true);
        expect((near.structuredContent as { suggestions: string[] }).suggestions).toContain('list_albums');
        expect(text(near)).toMatch(/Did you mean .*list_albums.*Use search_api/);

        const skip = 'skip_current_item';
        expect((await tool.handle({ name: skip }, manager)).structuredContent).toMatchObject({
            suggestions: expect.arrayContaining(['skip_the_current_item']),
        });
        expect((await tool.handle({ name: skip }, viewer)).structuredContent).not.toMatchObject({
            suggestions: expect.arrayContaining(['skip_the_current_item']),
        });
    });

    it('logs every call once, with the grant and how it went', async () => {
        const { context, info } = contextFor(['view']);

        await tool.handle({ name: 'get_album', arguments: { id: ALBUM } }, context);
        await tool.handle({ name: 'skip_the_current_item' }, context);

        expect(info.mock.calls.map(([, fields]) => ({ ...fields, ms: 0 }))).toEqual([
            { operation: 'get_album', grantId: 'g-1', outcome: 'ok', ms: 0 },
            { operation: 'skip_the_current_item', grantId: 'g-1', outcome: 'refused', ms: 0 },
        ]);
    });
});

describe('call_api with several reads', () => {
    type Batch = { results: Array<{ name: string; ok: boolean; answer?: unknown; error?: string; suggestions?: string[] }> };

    it('runs each read and answers each on its own, a refusal beside a success', async () => {
        const { context, stubs } = contextFor(['view']);

        const result = await tool.handle(
            {
                calls: [{ name: 'list_plugins', fields: ['id'] }, { name: 'get_album', arguments: { id: 'not-an-album' } }, { name: 'list_album' }],
            },
            context,
        );
        const { results } = result.structuredContent as Batch;

        expect(result.isError).toBeUndefined();
        expect(results[0]).toEqual({ name: 'list_plugins', ok: true, answer: { items: [{ id: 'deadair.lastfm' }] } });
        expect(results[1]).toMatchObject({ name: 'get_album', ok: false, error: expect.stringMatching(/^The arguments were not valid/) });
        expect(results[2]).toMatchObject({ name: 'list_album', ok: false, suggestions: expect.arrayContaining(['list_albums']) });
        expect(stubs.AlbumsService.getAlbum).not.toHaveBeenCalled();
    });

    it('refuses a batch with a write in it before running any of it', async () => {
        const { context, stubs } = contextFor(['view', 'manage']);

        const result = await tool.handle({ calls: [{ name: 'list_plugins' }, { name: 'skip_the_current_item' }] }, context);

        expect(result.isError).toBe(true);
        expect(text(result)).toMatch(/skip_the_current_item changes the station/);
        expect(stubs.PluginsService.listPlugins).not.toHaveBeenCalled();
        expect(stubs.PlayoutService.skip).not.toHaveBeenCalled();
    });

    it(`refuses more than ${BATCH_LIMIT}, and an empty batch`, async () => {
        const { context, stubs } = contextFor(['view']);

        const many = await tool.handle({ calls: Array.from({ length: BATCH_LIMIT + 1 }, () => ({ name: 'list_plugins' })) }, context);
        expect(many.isError).toBe(true);
        expect((await tool.handle({ calls: [] }, context)).isError).toBe(true);
        expect(stubs.PluginsService.listPlugins).not.toHaveBeenCalled();
    });

    it('shares the size ceiling, so a batch costs no more context than one call', async () => {
        const long = { items: Array.from({ length: 2000 }, (_, n) => ({ id: `track-${n}`, title: `A title long enough to add up ${n}` })) };
        const stubs = { ...services(), PluginsService: { listPlugins: vi.fn(async () => long.items) } } as unknown as ReturnType<typeof services>;
        const { context } = contextFor(['view'], stubs);

        const result = await tool.handle({ calls: [{ name: 'list_plugins' }, { name: 'list_plugins' }] }, context);

        expect(text(result).length).toBeLessThanOrEqual(RESULT_CHAR_LIMIT + 500);
        expect((result.structuredContent as Batch).results.every(entry => entry.ok)).toBe(true);
    });

    it('logs each read it ran', async () => {
        const { context, info } = contextFor(['view']);

        await tool.handle({ calls: [{ name: 'list_plugins' }, { name: 'list_albums' }] }, context);

        expect(info.mock.calls.map(([, fields]) => (fields as { operation: string }).operation)).toEqual(['list_plugins', 'list_albums']);
    });
});

describe('shape', () => {
    const record = (n: number) => ({ id: `track-${n}`, title: `A title long enough to add up ${n}`, artist: 'Somebody', plays: n });

    it('keeps an answer that fits whole', () => {
        expect(shape({ items: [record(1)], total: 1 }, []).structuredContent).toEqual({ items: [record(1)], total: 1 });
    });

    it('cuts a long answer to whole records under the limit, and says how many there were', () => {
        const long = { items: Array.from({ length: 2000 }, (_, n) => record(n)), total: 2000 };

        const result = shape(long, []);
        const answer = result.structuredContent as { items: unknown[]; truncated: { shown: number; of: number } };

        expect(text(result).length).toBeLessThanOrEqual(RESULT_CHAR_LIMIT);
        expect(answer.items.length).toBe(answer.truncated.shown);
        expect(answer.truncated.of).toBe(2000);
        expect(answer.items[0]).toEqual(record(0));
    });

    it('fits more records once they are projected', () => {
        const long = { items: Array.from({ length: 2000 }, (_, n) => record(n)) };

        const whole = (shape(long, []).structuredContent as { truncated: { shown: number } }).truncated.shown;
        const projected = (shape(long, ['id']).structuredContent as { truncated: { shown: number } }).truncated.shown;

        expect(projected).toBeGreaterThan(whole);
    });
});
