// The account's own keys. What is pinned here is what the station adds on top of ServerKit's
// ApiKeyService: that a key can never reach these routes, that somebody else's key reads as one that
// does not exist, that manage is stored with view, and that issuing and rotating sit behind the
// step-up while revoking does not.

import { describe, expect, it, vi } from 'vitest';
import { DateTime } from 'luxon';
import { IsHttpError } from '@maroonedsoftware/errors';
import type { ApiKey, ApiKeyService } from '@maroonedsoftware/authentication';

import { ApiKeysService } from '../../../src/modules/authentication/api.keys.service.js';
import { AuthorizationContext, type UserActor } from '../../../src/modules/permissions/authorization.context.js';
import type { StrongFactorGate } from '../../../src/modules/authentication/strong.factor.gate.js';

const OWNER = 'u-owner';
const CREATED = DateTime.fromISO('2026-09-14T12:00:00Z');

const stored = (overrides: Partial<ApiKey> = {}): ApiKey => ({
    id: 'k-1',
    owner: { kind: 'user', actorId: OWNER },
    name: 'doorbell',
    hint: 'da_AbCdE',
    secretHash: 'never-returned',
    scopes: ['view'],
    metadata: {},
    createdAt: CREATED,
    ...overrides,
});

const person = (apiKey?: UserActor['apiKey']): UserActor => ({
    kind: 'user',
    sessionToken: 's-1',
    actorId: OWNER,
    factors: [],
    platformRoles: new Set(['admin']),
    ...(apiKey ? { apiKey } : {}),
});

const build = (options: { actor?: UserActor; existing?: ApiKey } = {}) => {
    const apiKeys = {
        listForOwner: vi.fn().mockResolvedValue([stored(), stored({ id: 'k-2', revokedAt: CREATED.plus({ days: 1 }) })]),
        create: vi.fn(async (input: { scopes: string[]; name: string }) => ({
            key: stored({ scopes: input.scopes, name: input.name }),
            token: 'da_token',
        })),
        get: vi.fn().mockResolvedValue(options.existing ?? stored()),
        rotate: vi.fn().mockResolvedValue({ key: stored(), token: 'da_new' }),
        revoke: vi.fn().mockResolvedValue(stored({ revokedAt: CREATED })),
    };
    const gate = { assertRecentIfAnyEnrolled: vi.fn().mockResolvedValue(undefined) };
    const service = new ApiKeysService(
        apiKeys as unknown as ApiKeyService,
        new AuthorizationContext(options.actor ?? person()),
        gate as unknown as StrongFactorGate,
    );
    return { service, apiKeys, gate };
};

const statusOf = async (promise: Promise<unknown>) => {
    const error = await promise.catch((e: unknown) => e);
    return IsHttpError(error) ? error.statusCode : undefined;
};

describe('ApiKeysService', () => {
    it('lists the account’s keys, revoked ones included, and never the hash', async () => {
        const { service, apiKeys } = build();

        const { keys } = await service.list();

        expect(apiKeys.listForOwner).toHaveBeenCalledWith({ kind: 'user', actorId: OWNER }, { includeInactive: true });
        expect(keys.map(key => key.id)).toEqual(['k-1', 'k-2']);
        expect(keys[1]?.revokedAt).toBeDefined();
        expect(JSON.stringify(keys)).not.toContain('never-returned');
    });

    it('issues a key for the caller and hands the token back once', async () => {
        const { service, apiKeys, gate } = build();

        const issued = await service.create({ name: '  doorbell  ', scopes: ['view'] });

        expect(gate.assertRecentIfAnyEnrolled).toHaveBeenCalledWith(OWNER);
        expect(apiKeys.create).toHaveBeenCalledWith({ owner: { kind: 'user', actorId: OWNER }, name: 'doorbell', scopes: ['view'] });
        expect(issued.token).toBe('da_token');
    });

    it('stores manage with view, so the list says what the key can do', async () => {
        const { service, apiKeys } = build();

        await service.create({ name: 'backup', scopes: ['manage'] });

        expect(apiKeys.create).toHaveBeenCalledWith(expect.objectContaining({ scopes: ['view', 'manage'] }));
    });

    it('refuses a key with no scope, before the step-up is asked for', async () => {
        const { service, gate } = build();

        expect(await statusOf(service.create({ name: 'nothing', scopes: [] }))).toBe(400);
        expect(gate.assertRecentIfAnyEnrolled).not.toHaveBeenCalled();
    });

    it('rotates the caller’s key behind the step-up', async () => {
        const { service, apiKeys, gate } = build();

        await expect(service.rotate('k-1')).resolves.toMatchObject({ token: 'da_new' });
        expect(gate.assertRecentIfAnyEnrolled).toHaveBeenCalledWith(OWNER);
        expect(apiKeys.rotate).toHaveBeenCalledWith('k-1');
    });

    it('revokes the caller’s key without asking for a step-up', async () => {
        const { service, apiKeys, gate } = build();

        await service.revoke('k-1');

        expect(apiKeys.revoke).toHaveBeenCalledWith('k-1');
        expect(gate.assertRecentIfAnyEnrolled).not.toHaveBeenCalled();
    });

    it.each([
        ['rotate', (s: ApiKeysService) => s.rotate('k-1')],
        ['revoke', (s: ApiKeysService) => s.revoke('k-1')],
    ])('answers 404 when asked to %s somebody else’s key, as if it did not exist', async (_name, act) => {
        const { service, apiKeys } = build({ existing: stored({ owner: { kind: 'user', actorId: 'u-somebody-else' } }) });

        expect(await statusOf(act(service))).toBe(404);
        expect(apiKeys.rotate).not.toHaveBeenCalled();
        expect(apiKeys.revoke).not.toHaveBeenCalled();
    });

    it.each([
        ['list', (s: ApiKeysService) => s.list()],
        ['create', (s: ApiKeysService) => s.create({ name: 'more', scopes: ['view'] })],
        ['rotate', (s: ApiKeysService) => s.rotate('k-1')],
        ['revoke', (s: ApiKeysService) => s.revoke('k-1')],
    ])('refuses to %s for a request made with a key, even one that may manage', async (_name, act) => {
        const { service, apiKeys } = build({ actor: person({ id: 'k-1', name: 'doorbell', grants: new Set(['view', 'manage']) }) });

        expect(await statusOf(act(service))).toBe(403);
        expect(apiKeys.listForOwner).not.toHaveBeenCalled();
        expect(apiKeys.create).not.toHaveBeenCalled();
    });
});
