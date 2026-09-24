// The catalog `search_api` searches and `call_api` calls, built from the real generated handlers.
// These pin what is in it and what it says about each operation, since a model decides what to call,
// and whether to ask first, from exactly this.

import { describe, expect, it } from 'vitest';

import { McpToolCatalog, registerMcpCatalog } from '../../src/mcp/mcp.tools.js';
import { accessOf, catalogEntries, mayUse, SEARCH_LIMIT, searchCatalog, SECURITY_META, type CatalogEntry } from '../../src/mcp/api.catalog.js';
import type { UserActor } from '../../src/modules/permissions/authorization.context.js';

/** The generated tools resolve everything per call, so each is built with nothing. */
const catalog: McpToolCatalog = registerMcpCatalog({ get: (Tool: new () => unknown) => new Tool() } as never);
const entries = catalogEntries(catalog.values());
const byName = new Map(entries.map(entry => [entry.name, entry]));

const actor = (roles: Array<'admin' | 'listener'>, grants?: Array<'view' | 'manage'>): UserActor => ({
    kind: 'user',
    sessionToken: 's',
    actorId: 'u-1',
    factors: [],
    platformRoles: new Set(roles),
    ...(grants ? { grant: { id: 'g-1', clientId: 'dyn_1', grants: new Set(grants) } } : {}),
});

describe('the catalog', () => {
    it('holds the station’s operations, the listed ones among them', () => {
        expect(entries.length).toBeGreaterThan(150);
        expect(byName.has('get_now_playing')).toBe(true);
        expect(byName.has('skip_the_current_item')).toBe(true);
    });

    it('leaves out signing in, credentials, connected apps, secrets, log files and the long model calls', () => {
        for (const name of [
            'request_token',
            'start_login',
            'create_api_key',
            'register_factor',
            'logout',
            'approve_authorization_request',
            'revoke_oauth_grant',
            'update_plugin_configuration',
            'start_plugin_oauth_authorization',
            'update_settings',
            'start_fetcher_authorization',
            'create_messaging_link_code',
            'read_log',
            'generate_persona',
            'rehearse_persona',
        ]) {
            expect(byName.has(name), name).toBe(false);
        }
    });

    it('asks every operation for a named station policy or none, never the MFA default a contract with no security gets', () => {
        // `policy.mappings.ts` maps `mfa.satisfied` to no real check, so an operation that declared no
        // security would be reachable by any grant. Every contract names its policy; this keeps it so.
        const policies = new Set(entries.map(entry => JSON.stringify(entry.definition._meta?.[SECURITY_META])));
        expect([...policies].sort()).toEqual(['"none"', '{"policy":"platform.manage"}', '{"policy":"platform.view"}']);
    });

    it('reads a policy as the tier it asks for', () => {
        expect(accessOf(byName.get('get_now_playing')!.definition)).toBe('anyone');
        expect(accessOf(byName.get('get_playout_status')!.definition)).toBe('view');
        expect(accessOf(byName.get('skip_the_current_item')!.definition)).toBe('manage');
    });

    describe('hints a model can trust', () => {
        const WRITES =
            /^(create|delete|update|remove|set|add|write|revoke|cancel|grant|decline|import|fill|hide|show|rate|clear|retry|restore|roll|refresh|rescan|reload|enable|disable|start|stop|skip|play|put|hold|release|move|shuffle|extend|replan|recast|request|fetch|render|scan|test|suggest|check|offer)_/;

        it('never marks as read-only an operation whose name says it changes something', () => {
            const dishonest = entries.filter(entry => entry.readOnly && WRITES.test(entry.name)).map(entry => entry.name);
            expect(dishonest).toEqual([]);
        });

        it('marks every delete destructive', () => {
            const deletes = entries.filter(entry => /^(delete|remove)_/.test(entry.name));
            expect(deletes.length).toBeGreaterThan(0);
            expect(deletes.filter(entry => !entry.destructive).map(entry => entry.name)).toEqual([]);
        });
    });
});

describe('who may use an operation', () => {
    const view = byName.get('get_playout_status')!.access;
    const manage = byName.get('skip_the_current_item')!.access;

    it('needs the role and, for a connected app, the grant', () => {
        expect(mayUse(actor(['admin'], ['view', 'manage']), manage)).toBe(true);
        expect(mayUse(actor(['admin'], ['view']), manage)).toBe(false);
        expect(mayUse(actor(['listener'], ['view', 'manage']), manage)).toBe(false);
        expect(mayUse(actor(['listener'], ['view']), view)).toBe(true);
        expect(mayUse(actor([], ['view']), view)).toBe(false);
        expect(mayUse(actor([], []), 'anyone')).toBe(true);
    });
});

describe('searchCatalog', () => {
    it('ranks a name match above a description match, reads first among equals', () => {
        const { results } = searchCatalog(entries, { query: 'playlist' });
        expect(results[0]!.name).toMatch(/playlist/);
        expect(results.every(entry => /playlist/i.test(`${entry.name} ${entry.description} ${entry.fields.join(' ')}`))).toBe(true);
    });

    it('answers at most the limit, with the total before it', () => {
        const { total, results } = searchCatalog(entries, {});
        expect(total).toBe(entries.length);
        expect(results).toHaveLength(SEARCH_LIMIT);
    });

    it('filters to reads or writes', () => {
        expect(searchCatalog(entries, { query: 'persona', readOnly: true }).results.every(entry => entry.readOnly)).toBe(true);
        expect(searchCatalog(entries, { query: 'persona', readOnly: false }).results.every(entry => !entry.readOnly)).toBe(true);
    });

    it('answers nothing for words that match nothing', () => {
        expect(searchCatalog(entries, { query: 'zyzzyva' })).toEqual({ total: 0, results: [] });
    });

    it('weighs argument names, so an operation is found by what it takes', () => {
        const withSearch = (entry: CatalogEntry) => entry.fields.includes('search');
        expect(searchCatalog(entries, { query: 'search' }).results.some(withSearch)).toBe(true);
    });
});
