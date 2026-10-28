// Adding a passkey to an account that already exists. The email and authenticator registrations both
// refuse a registration id redeemed by anybody but the actor it was issued to; the passkey one did
// not, and the factor service checks the attestation and nothing about who is redeeming it. So the
// app enforced no binding of its own between the id and the session finishing it.
//
// Built off the prototype like the other authentication tests, with only the collaborators these
// two paths touch, over an in-memory cache so what registering writes is what verifying reads.

import { describe, expect, it, vi } from 'vitest';
import { DateTime } from 'luxon';
import { IsHttpError } from '@maroonedsoftware/errors';

import { AuthenticationRegistrationService } from '../../../src/modules/authentication/authentication.registration.service.js';

const OWNER = '11111111-1111-4111-8111-111111111111';
const SOMEONE_ELSE = '22222222-2222-4222-8222-222222222222';
const CREDENTIAL = { id: 'cred', rawId: 'cred', type: 'public-key', response: { clientDataJSON: 'x', attestationObject: 'y' } };

const build = () => {
    const store = new Map<string, string>();
    const cacheProvider = {
        get: vi.fn(async (key: string) => store.get(key) ?? null),
        set: vi.fn(async (key: string, value: string) => void store.set(key, value)),
        delete: vi.fn(async (key: string) => void store.delete(key)),
    };
    const fidoFactorService = {
        registerFidoFactor: vi.fn().mockResolvedValue({
            registrationId: 'reg-fido',
            expiresAt: DateTime.utc().plus({ minutes: 1 }),
            issuedAt: DateTime.utc(),
            attestation: { challenge: 'abc' },
            alreadyRegistered: false,
        }),
        createFidoFactorFromRegistration: vi.fn().mockResolvedValue({ id: 'fido-1' }),
    };

    const service = Object.create(AuthenticationRegistrationService.prototype) as AuthenticationRegistrationService;
    Object.assign(service, {
        cacheProvider,
        fidoFactorService,
        emailFactorService: { listFactors: vi.fn().mockResolvedValue([{ value: 'someone@example.com' }]) },
        passkeyRelyingParty: { resolve: () => ({ rpId: 'radio.example.com', rpOrigin: 'https://radio.example.com', rpName: 'Station' }) },
    });

    const internals = service as unknown as {
        registerFidoFactor: (actorId: string, request: unknown) => Promise<{ registrationId: string }>;
        verifyFidoFactorRegistration: (actorId: string, request: unknown) => Promise<{ method: string; methodId: string }>;
    };
    const register = (actorId = OWNER) => internals.registerFidoFactor(actorId, { method: 'fido', label: 'Laptop' });
    const verify = (actorId: string, registrationId = 'reg-fido') =>
        internals.verifyFidoFactorRegistration(actorId, { method: 'fido', registrationId, credential: CREDENTIAL });

    return { register, verify, fidoFactorService, store };
};

const statusOf = async (promise: Promise<unknown>) => {
    const error = await promise.catch((e: unknown) => e);
    return IsHttpError(error) ? error.statusCode : undefined;
};

describe('adding a passkey', () => {
    it('lets the actor it was issued to finish it', async () => {
        const { register, verify, fidoFactorService } = build();
        await register();

        await expect(verify(OWNER)).resolves.toMatchObject({ method: 'fido', methodId: 'fido-1' });
        expect(fidoFactorService.createFidoFactorFromRegistration).toHaveBeenCalledWith(OWNER, 'reg-fido', CREDENTIAL);
    });

    it('refuses somebody else redeeming the registration, before the attestation is looked at', async () => {
        const { register, verify, fidoFactorService } = build();
        await register(OWNER);

        expect(await statusOf(verify(SOMEONE_ELSE))).toBe(400);
        expect(fidoFactorService.createFidoFactorFromRegistration).not.toHaveBeenCalled();
    });

    it('refuses a registration id the station never issued', async () => {
        const { verify, fidoFactorService } = build();

        expect(await statusOf(verify(OWNER, 'made-up'))).toBe(400);
        expect(fidoFactorService.createFidoFactorFromRegistration).not.toHaveBeenCalled();
    });

    it('forgets the registration once it is spent', async () => {
        const { register, verify, store } = build();
        await register();

        await verify(OWNER);

        expect([...store.keys()].filter(key => key.includes('reg-fido') || key.endsWith(':fido'))).toEqual([]);
    });
});
