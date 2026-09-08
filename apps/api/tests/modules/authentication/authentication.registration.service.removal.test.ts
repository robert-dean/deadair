// Removing a factor is the change a stolen session would most like to make, so it sits behind the
// same gate as enrolling one: a strong factor verified within the last five minutes, once any
// strong factor exists. What is pinned here is that gate, the caller scoping, and that nothing
// but an authenticator is answered yet.
//
// Built off the prototype with only the collaborators on this path, the way the other
// authentication tests are: the constructor populates a handler map this method never reads.

import { describe, expect, it, vi } from 'vitest';
import { httpError, IsHttpError } from '@maroonedsoftware/errors';

import { AuthenticationRegistrationService } from '../../../src/modules/authentication/authentication.registration.service.js';

const ACTOR_ID = '11111111-1111-4111-8111-111111111111';
const FACTOR_ID = 'totp-1';

const build = (options: { authenticated?: boolean; enrolled?: { method: string }[]; stepUpDenied?: boolean; factorExists?: boolean } = {}) => {
    const authorizationContext = {
        requireAuthentication: vi.fn(() => {
            if (options.authenticated === false) throw httpError(403).withDetails({ message: 'human authentication required' });
            return { actorId: ACTOR_ID, sessionToken: 'session' };
        }),
    };
    const actorsRepository = {
        listFactors: vi.fn().mockResolvedValue(options.enrolled ?? [{ method: 'password' }, { method: 'authenticator' }]),
    };
    const policyService = {
        assert: vi.fn(async () => {
            if (options.stepUpDenied) {
                throw httpError(403).withDetails({
                    kind: 'step_up_required',
                    stepUp: { within: 'PT5M', excludeMethods: ['email', 'password', 'oidc'] },
                });
            }
        }),
    };
    const authenticatorFactorService = {
        getFactor: vi.fn(async () => {
            if (options.factorExists === false) throw new Error('no rows');
            return { id: FACTOR_ID, actorId: ACTOR_ID, active: true };
        }),
        deleteFactor: vi.fn().mockResolvedValue(undefined),
    };

    const service = Object.create(AuthenticationRegistrationService.prototype) as AuthenticationRegistrationService;
    Object.assign(service, { authorizationContext, actorsRepository, policyService, authenticatorFactorService });

    const remove = (method = 'authenticator', methodId = FACTOR_ID) => service.removeFactor(method as never, methodId);

    return { remove, policyService, authenticatorFactorService };
};

const statusOf = async (promise: Promise<unknown>) => {
    const error = await promise.catch((e: unknown) => e);
    return IsHttpError(error) ? error.statusCode : undefined;
};

describe('removing a factor', () => {
    it('needs a signed-in human', async () => {
        const h = build({ authenticated: false });

        expect(await statusOf(h.remove())).toBe(403);
        expect(h.authenticatorFactorService.deleteFactor).not.toHaveBeenCalled();
    });

    it('answers only an authenticator for now', async () => {
        const h = build();

        expect(await statusOf(h.remove('fido', 'key-1'))).toBe(400);
        expect(h.policyService.assert).not.toHaveBeenCalled();
    });

    it('is refused without a recent strong factor, and says so the way the console expects', async () => {
        const h = build({ stepUpDenied: true });

        const error = await h.remove().catch((e: unknown) => e);

        expect(IsHttpError(error) && error.statusCode).toBe(403);
        expect(h.policyService.assert).toHaveBeenCalledWith(
            'auth.session.recent.factor',
            expect.objectContaining({ excludeMethods: ['email', 'password', 'oidc'] }),
        );
        expect(h.authenticatorFactorService.deleteFactor).not.toHaveBeenCalled();
    });

    it("answers 404 for a factor that is not the caller's, indistinguishably from one that never existed", async () => {
        const h = build({ factorExists: false });

        expect(await statusOf(h.remove('authenticator', 'somebody-elses'))).toBe(404);
        expect(h.authenticatorFactorService.getFactor).toHaveBeenCalledWith(ACTOR_ID, 'somebody-elses');
        expect(h.authenticatorFactorService.deleteFactor).not.toHaveBeenCalled();
    });

    it("deactivates the caller's own factor once the gate is passed", async () => {
        const h = build();

        await expect(h.remove()).resolves.toBeUndefined();

        expect(h.policyService.assert).toHaveBeenCalledOnce();
        expect(h.authenticatorFactorService.deleteFactor).toHaveBeenCalledWith(ACTOR_ID, FACTOR_ID);
    });
});
