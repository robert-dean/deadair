// `/auth/login/start` with `grant_type: 'fido'`. It answered 400 for an address with no account, 404
// "no factors found" for an account with no passkey and 200 for one with a passkey, with no limit on
// how often it could be asked: an anonymous account-enumeration oracle, beside the link and code
// starts that already refuse to be one. Now the first two answer the same decoy, and every start is
// throttled per address before anything is looked up.

import { describe, expect, it, vi } from 'vitest';
import { DateTime, Duration } from 'luxon';
import { httpError, IsHttpError } from '@maroonedsoftware/errors';

import { AuthenticationService } from '../../../src/modules/authentication/authentication.service.js';

const ACTOR_ID = '11111111-1111-4111-8111-111111111111';
const EMAIL = 'someone@example.com';
const RP = { rpId: 'radio.example.com', rpOrigin: 'https://radio.example.com', rpName: 'Station' };

type Account = 'none' | 'inactive' | 'no-passkey' | 'passkey';

type StartAnswer = {
    grant_type: string;
    challengeId: string;
    expiresAt: DateTime;
    assertion: {
        challenge: string;
        timeout?: number;
        rpId?: string;
        userVerification?: string;
        allowCredentials?: unknown[];
        rawChallenge?: unknown;
    };
};

const build = (account: Account, options: { limited?: boolean; factorError?: unknown } = {}) => {
    const emailFactorRepository = {
        findFactor: vi
            .fn()
            .mockResolvedValue(account === 'none' ? undefined : { id: 'email-1', actorId: ACTOR_ID, active: account !== 'inactive', value: EMAIL }),
    };
    const fidoFactorService = {
        createFidoAuthorizationChallenge: vi.fn(async () => {
            if (options.factorError) throw options.factorError;
            if (account === 'no-passkey') throw httpError(404).withDetails({ actorId: 'no factors found' });
            const challenge = Buffer.alloc(128, 7);
            return {
                challengeId: 'real-challenge',
                expiresAt: DateTime.utc().plus({ minutes: 1 }),
                issuedAt: DateTime.utc(),
                alreadyIssued: false,
                assertion: {
                    challenge: challenge.toString('base64'),
                    timeout: 60_000,
                    rpId: RP.rpId,
                    userVerification: 'preferred',
                    rawChallenge: challenge,
                    allowCredentials: [{ id: 'cred-1', type: 'public-key' }],
                },
            };
        }),
    };
    const signInMailLimiter = {
        consume: vi.fn(async () => {
            if (options.limited) throw httpError(429).withDetails({ email: 'Too many sign-in emails' });
        }),
    };

    const service = Object.create(AuthenticationService.prototype) as AuthenticationService;
    Object.assign(service, {
        emailFactorRepository,
        fidoFactorService,
        signInMailLimiter,
        passkeyRelyingParty: { resolveForAssertion: () => RP },
        fidoFactorServiceOptions: { timeout: Duration.fromMillis(60_000) },
    });

    const start = () =>
        (service as never as { handleFidoStartLogin: (r: unknown) => Promise<StartAnswer> }).handleFidoStartLogin({
            grant_type: 'fido',
            email: EMAIL,
        });

    return { start, emailFactorRepository, fidoFactorService, signInMailLimiter };
};

/** Everything about an answer that is not random, so two answers can be compared for shape. */
const shapeOf = (answer: StartAnswer) => ({
    grant_type: answer.grant_type,
    keys: Object.keys(answer).sort(),
    assertionKeys: Object.keys(answer.assertion).sort(),
    challengeBytes: Buffer.from(answer.assertion.challenge, 'base64').length,
    timeout: answer.assertion.timeout,
    rpId: answer.assertion.rpId,
    userVerification: answer.assertion.userVerification,
    allowCredentials: answer.assertion.allowCredentials,
});

describe('starting a passkey sign-in', () => {
    it('answers an unknown address, an inactive one and an account with no passkey identically', async () => {
        const answers = await Promise.all((['none', 'inactive', 'no-passkey'] as const).map(account => build(account).start()));

        const [first, ...rest] = answers.map(shapeOf);
        for (const shape of rest) expect(shape).toEqual(first);
        expect(first).toMatchObject({ grant_type: 'fido', challengeBytes: 128, timeout: 60_000, rpId: RP.rpId, allowCredentials: [] });
    });

    it('shapes the decoy like a real answer, less the credentials only an enrolled account has', async () => {
        const decoy = shapeOf(await build('none').start());
        const real = shapeOf(await build('passkey').start());

        expect({ ...decoy, allowCredentials: undefined }).toEqual({ ...real, allowCredentials: undefined });
        expect(real.allowCredentials).toHaveLength(1);
    });

    it('mints a fresh challenge id and challenge each time, expiring from now', async () => {
        const { start } = build('none');
        const before = DateTime.utc();

        const one = await start();
        const two = await start();

        expect(one.challengeId).not.toBe(two.challengeId);
        expect(one.assertion.challenge).not.toBe(two.assertion.challenge);
        expect(one.expiresAt.toMillis()).toBeGreaterThanOrEqual(before.plus({ minutes: 1 }).toMillis());
    });

    it('throttles per address before looking anything up', async () => {
        const { start, emailFactorRepository, signInMailLimiter } = build('passkey', { limited: true });

        const error = await start().catch((e: unknown) => e);

        expect(IsHttpError(error) && error.statusCode).toBe(429);
        expect(signInMailLimiter.consume).toHaveBeenCalledWith(EMAIL);
        expect(emailFactorRepository.findFactor).not.toHaveBeenCalled();
    });

    it('still surfaces a factor-service failure that is not "no passkey"', async () => {
        const { start } = build('passkey', { factorError: httpError(500) });

        const error = await start().catch((e: unknown) => e);

        expect(IsHttpError(error) && error.statusCode).toBe(500);
    });

    it('never sends the raw challenge bytes', async () => {
        expect((await build('passkey').start()).assertion).not.toHaveProperty('rawChallenge');
        expect((await build('none').start()).assertion).not.toHaveProperty('rawChallenge');
    });
});
