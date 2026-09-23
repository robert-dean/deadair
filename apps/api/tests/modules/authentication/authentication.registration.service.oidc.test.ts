// Linking an identity provider to the account you are signed in to, and unlinking one. Linking is a
// change to how the account is protected, so it sits behind the same recent-strong-factor gate as
// enrolling anything else. Unlinking is refused when the provider is the only way the account signs
// in, which is exactly how an account made by signing in through one starts out.

import { describe, expect, it, vi } from 'vitest';
import { DateTime } from 'luxon';
import { IsHttpError } from '@maroonedsoftware/errors';

import { AuthenticationRegistrationService } from '../../../src/modules/authentication/authentication.registration.service.js';

const ACTOR_ID = '11111111-1111-4111-8111-111111111111';
const FACTOR_ID = 'oidc-1';

function build(options: { factors?: { method: string; methodId: string }[]; mailConfigured?: boolean; factorExists?: boolean } = {}) {
    const oidcFactorService = {
        beginAuthorization: vi.fn(async () => ({
            url: new URL('https://auth.example.com/authorize?state=s'),
            state: 's',
            expiresAt: DateTime.utc().plus({ minutes: 10 }),
        })),
        getFactor: vi.fn(async () => {
            if (options.factorExists === false) throw new Error('no rows');
            return { id: FACTOR_ID, actorId: ACTOR_ID, active: true, provider: 'authelia', subject: 'sub' };
        }),
        deleteFactor: vi.fn(async () => undefined),
    };
    const actorsRepository = { listFactors: vi.fn(async () => options.factors ?? [{ method: 'oidc', methodId: FACTOR_ID }]) };
    const service = Object.create(AuthenticationRegistrationService.prototype) as AuthenticationRegistrationService;
    Object.assign(service, {
        authorizationContext: { requireAuthentication: () => ({ actorId: ACTOR_ID, sessionToken: 'session' }) },
        strongFactorGate: { assertRecentIfAnyEnrolled: vi.fn(async () => undefined) },
        mailService: { isConfigured: () => options.mailConfigured ?? false },
        oidcFactorService,
        actorsRepository,
    });
    // The handler map is built in the constructor, which a prototype-built instance skips.
    Object.assign(service, {
        factorHandlerMap: new Map([
            ['oidc', { registerFactor: (actorId: string, request: never) => (service as any).registerOidcFactor(actorId, request) }],
        ]),
    });
    return { service, oidcFactorService };
}

const statusOf = async (promise: Promise<unknown>) => {
    const error = await promise.catch((e: unknown) => e);
    return IsHttpError(error) ? error.statusCode : undefined;
};

describe('linking an identity provider', () => {
    it('begins a link for the signed-in account and answers where the browser goes', async () => {
        const h = build();

        const response = await h.service.registerFactor({ method: 'oidc', provider: 'authelia' });

        expect(h.oidcFactorService.beginAuthorization).toHaveBeenCalledWith({ provider: 'authelia', intent: 'link', actorId: ACTOR_ID });
        expect(response).toMatchObject({ method: 'oidc', authorizeUrl: 'https://auth.example.com/authorize?state=s' });
    });
});

describe('unlinking an identity provider', () => {
    it('removes it when a password still signs the account in', async () => {
        const h = build({
            factors: [
                { method: 'password', methodId: 'p' },
                { method: 'oidc', methodId: FACTOR_ID },
            ],
        });

        await h.service.removeFactor('oidc', FACTOR_ID);

        expect(h.oidcFactorService.deleteFactor).toHaveBeenCalledWith(ACTOR_ID, FACTOR_ID);
    });

    it('removes it when another provider is still linked', async () => {
        const h = build({
            factors: [
                { method: 'oidc', methodId: 'other' },
                { method: 'oidc', methodId: FACTOR_ID },
            ],
        });

        await h.service.removeFactor('oidc', FACTOR_ID);

        expect(h.oidcFactorService.deleteFactor).toHaveBeenCalled();
    });

    it('refuses to remove the only way the account signs in', async () => {
        const h = build();

        expect(await statusOf(h.service.removeFactor('oidc', FACTOR_ID))).toBe(409);
        expect(h.oidcFactorService.deleteFactor).not.toHaveBeenCalled();
    });

    it('counts an email address only while the station can send it a sign-in link', async () => {
        const factors = [
            { method: 'email', methodId: 'e' },
            { method: 'oidc', methodId: FACTOR_ID },
        ];

        expect(await statusOf(build({ factors, mailConfigured: false }).service.removeFactor('oidc', FACTOR_ID))).toBe(409);
        await expect(build({ factors, mailConfigured: true }).service.removeFactor('oidc', FACTOR_ID)).resolves.toBeUndefined();
    });

    it("answers 404 for a provider link that is not the caller's", async () => {
        const h = build({ factorExists: false });
        expect(await statusOf(h.service.removeFactor('oidc', 'somebody-elses'))).toBe(404);
    });
});
