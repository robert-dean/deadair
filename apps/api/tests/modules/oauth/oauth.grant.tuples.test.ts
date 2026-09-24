// A connected app's grant is an object in the permissions model whose tuples are derived from its
// `oauth_grants` row rather than stored. These pin the derivation, and then run the real checker over
// the real `core.perm` through the station's own tuple repository, so the ceiling a grant session
// works under is exactly what its row says, and moves when the row does.

import { describe, expect, it } from 'vitest';
import { check } from '@maroonedsoftware/permissions';

import { grantTuples, OAUTH_GRANT_SCOPES, OAUTHGRANT_NAMESPACE, withStationScopes } from '../../../src/modules/oauth/oauth.grant.tuples.js';
import { OAUTH_SCOPES } from '../../../src/modules/oauth/oauth.module.js';
import { model } from '../../../src/modules/permissions/generated/index.js';
import { DeadairPermissionsTupleRepository } from '../../../src/modules/permissions/permissions.repository.js';

const GRANT = '8a4c1f0e-5b2d-4e6f-9a1b-2c3d4e5f6a7b';
const OWNER = 'u-1';

describe('the station scopes', () => {
    it('are the scoped_* relations of the oauthgrant namespace, offered beside mcp', () => {
        expect(OAUTH_GRANT_SCOPES).toEqual(['view', 'manage']);
        expect(OAUTH_SCOPES).toEqual(['mcp', 'view', 'manage']);
    });
});

describe('grantTuples', () => {
    it('derives the owner, the station, and one scoped relation per station scope', () => {
        const tuples = grantTuples({ id: GRANT, actorId: OWNER, scope: ['mcp', 'view'], revoked: false });

        expect(tuples.map(tuple => `${tuple.relation}@${tuple.subject.namespace}:${'id' in tuple.subject ? tuple.subject.id : '*'}`)).toEqual([
            'owner@user:u-1',
            'station@platform:main',
            'scoped_view@user:u-1',
        ]);
        expect(tuples.every(tuple => tuple.object.namespace === OAUTHGRANT_NAMESPACE && tuple.object.id === GRANT)).toBe(true);
    });

    it('derives nothing for a revoked grant', () => {
        expect(grantTuples({ id: GRANT, actorId: OWNER, scope: ['view', 'manage'], revoked: true })).toEqual([]);
    });
});

describe('withStationScopes', () => {
    it('gives a grant naming no station scope all of them, as a grant meant before there was a ceiling', () => {
        expect(withStationScopes(['mcp'])).toEqual(['mcp', 'view', 'manage']);
        expect(withStationScopes([])).toEqual(['view', 'manage']);
    });

    it('leaves a grant that names one as it asked', () => {
        expect(withStationScopes(['mcp', 'view'])).toEqual(['mcp', 'view']);
    });
});

/**
 * Just enough of Kysely for the repository's reads: equality filters over in-memory rows. The two
 * tables are the grant and the stored tuples; a check against a grant reads the one for the grant and
 * the other for the owner's role on the station.
 */
const fakeDb = (tables: Record<string, Array<Record<string, unknown>>>) => ({
    selectFrom(table: string) {
        const filters: Array<[string, unknown]> = [];
        const builder = {
            where(column: string | ((eb: unknown) => unknown), _op?: string, value?: unknown) {
                if (typeof column === 'string') filters.push([column, value]);
                return builder;
            },
            select: () => builder,
            distinct: () => builder,
            execute: async () => (tables[table] ?? []).filter(row => filters.every(([column, value]) => row[column] === value)),
            executeTakeFirst: async () => (await builder.execute())[0],
        };
        return builder;
    },
});

const repository = (grant: { scope: string[]; revokedAt?: string }, ownerRole: 'admin' | 'listener' = 'admin') =>
    new DeadairPermissionsTupleRepository(
        fakeDb({
            'deadair.oauthGrants': [{ id: GRANT, actorId: OWNER, scope: grant.scope, revokedAt: grant.revokedAt }],
            'deadair.permissionsRelationTuples': [
                {
                    objectNamespace: 'platform',
                    objectId: 'main',
                    relation: ownerRole,
                    subjectNamespace: 'user',
                    subjectId: OWNER,
                    subjectRelation: '',
                },
            ],
        }) as never,
    );

const may = async (repo: DeadairPermissionsTupleRepository, permission: 'view' | 'manage') =>
    check(model, repo, { namespace: OAUTHGRANT_NAMESPACE, id: GRANT }, permission, { kind: 'concrete', namespace: 'user', id: OWNER });

describe('a grant checked through the station tuple repository', () => {
    it('may do what its stored scope says, and no more', async () => {
        const repo = repository({ scope: ['mcp', 'view'] });

        expect(await may(repo, 'view')).toBe(true);
        expect(await may(repo, 'manage')).toBe(false);
    });

    it('may manage when its row says manage and its owner may', async () => {
        expect(await may(repository({ scope: ['mcp', 'view', 'manage'] }), 'manage')).toBe(true);
    });

    it('never exceeds its owner', async () => {
        expect(await may(repository({ scope: ['mcp', 'view', 'manage'] }, 'listener'), 'manage')).toBe(false);
    });

    it('may do nothing once revoked', async () => {
        const repo = repository({ scope: ['mcp', 'view', 'manage'], revokedAt: '2026-09-24T12:00:00Z' });

        expect(await may(repo, 'view')).toBe(false);
    });

    it('answers no grant, rather than a database error, for an id that is not a uuid', async () => {
        const repo = repository({ scope: ['view'] });
        const bogus = await check(model, repo, { namespace: OAUTHGRANT_NAMESPACE, id: 'not-a-grant' }, 'view', {
            kind: 'concrete',
            namespace: 'user',
            id: OWNER,
        });

        expect(bogus).toBe(false);
    });

    it('refuses to store a grant tuple, since they are derived', async () => {
        const repo = repository({ scope: ['view'] });
        const [owner] = grantTuples({ id: GRANT, actorId: OWNER, scope: [], revoked: false });

        await expect(repo.write([owner!])).rejects.toThrow(/derived/);
        await expect(repo.delete([owner!])).rejects.toThrow(/derived/);
    });
});
