// `startFactorChallenge` dispatches on the method the SPA picked off a pending MFA challenge, and
// the arm that matters here is the one for a method nobody has built. It used to be no arm at all:
// the switch answered `fido` and fell off the end, and the `undefined` that produced went into the
// response `parseAndValidate`, which reported `400 {"_root":"Expected object"}` — indistinguishable
// from the client having sent no body. The test pins the status rather than the message, because
// the status is the part that told the wrong story.
//
// Built off the prototype like `authentication.service.refresh.test.ts`: the service takes
// twenty-odd collaborators and this path touches one.

import { describe, expect, it, vi } from 'vitest';
import { IsHttpError } from '@maroonedsoftware/errors';

import { AuthenticationService } from '../../../src/modules/authentication/authentication.service.js';

const ACTOR_ID = '11111111-1111-4111-8111-111111111111';
const CHALLENGE_ID = 'mfa-challenge';

const build = () => {
    const mfaChallengeService = {
        peek: vi.fn().mockResolvedValue({
            actor: { kind: 'user', actorId: ACTOR_ID },
            eligibleFactors: [{ method: 'fido', methodId: 'key-1', kind: 'possession' }],
        }),
    };
    const fidoFactorService = {
        createFidoAuthorizationChallenge: vi.fn().mockResolvedValue({
            challengeId: 'fido-challenge',
            assertion: { challenge: 'abc' },
            expiresAt: '2026-01-01T00:00:00.000Z',
        }),
    };

    const service = Object.create(AuthenticationService.prototype) as AuthenticationService;
    Object.assign(service, { mfaChallengeService, fidoFactorService, options: {} });

    return { service, mfaChallengeService, fidoFactorService };
};

const statusOf = async (promise: Promise<unknown>): Promise<number | undefined> => {
    const error = await promise.catch((e: unknown) => e);
    return IsHttpError(error) ? error.statusCode : undefined;
};

describe('starting a factor challenge for a method that is not implemented', () => {
    it('answers 501 for email rather than a validation failure against its own response', async () => {
        const { service } = build();

        const status = await statusOf(service.startFactorChallenge({ method: 'email', mfa_challenge_id: CHALLENGE_ID }));

        expect(status).toBe(501);
    });

    it('answers 501 for phone', async () => {
        const { service } = build();

        const status = await statusOf(service.startFactorChallenge({ method: 'phone', transport: 'sms', mfa_challenge_id: CHALLENGE_ID }));

        expect(status).toBe(501);
    });

    it('names the method it cannot answer for, so the caller is not left reading it as a bad body', async () => {
        const { service } = build();

        const error = await service.startFactorChallenge({ method: 'email', mfa_challenge_id: CHALLENGE_ID }).catch((e: unknown) => e);

        expect(IsHttpError(error) ? error.details : undefined).toEqual({ method: 'email factor challenges are not implemented' });
    });

    it('refuses before looking the MFA challenge up, since the answer cannot depend on it', async () => {
        const { service, mfaChallengeService } = build();

        await statusOf(service.startFactorChallenge({ method: 'email', mfa_challenge_id: CHALLENGE_ID }));

        expect(mfaChallengeService.peek).not.toHaveBeenCalled();
    });

    it('still answers the method it does implement', async () => {
        const { service, fidoFactorService } = build();

        const result = await service.startFactorChallenge({ method: 'fido', mfa_challenge_id: CHALLENGE_ID });

        expect(result).toMatchObject({ method: 'fido', fido_challenge_id: 'fido-challenge' });
        expect(fidoFactorService.createFidoAuthorizationChallenge).toHaveBeenCalledWith(ACTOR_ID, 'key-1', expect.anything());
    });
});
