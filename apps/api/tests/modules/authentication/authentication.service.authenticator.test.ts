// The authenticator grant is the second half of a sign-in that stopped at `mfa_required`, and the
// two checks it makes BEFORE handing the code to the orchestrator are the ones worth pinning: a
// challenge that does not exist is refused, and a `method_id` the challenge never offered is
// refused without the factor service ever seeing it. The second one matters because
// `validateFactor` has side effects (an attempt counter that ends in a 429), so a leaked challenge
// id must not be a way to probe arbitrary factor ids through them.
//
// Built the way the refresh test builds its service: off the prototype, with only the collaborators
// this path touches assigned. The constructor populates a grant-handler map these tests bypass.

import { describe, expect, it, vi } from 'vitest';
import { DateTime } from 'luxon';
import { IsHttpError } from '@maroonedsoftware/errors';

import { AuthenticationService } from '../../../src/modules/authentication/authentication.service.js';

const ACTOR_ID = '11111111-1111-4111-8111-111111111111';
const CHALLENGE_ID = 'mfa-challenge';
const SESSION_TOKEN = 'session-token';

const TOKENS = {
    accessToken: 'access',
    refreshToken: 'refresh',
    expiresIn: 900,
    tokenType: 'Bearer',
    scope: '',
};

const now = DateTime.utc();
const primaryFactor = { issuedAt: now, authenticatedAt: now, method: 'password', methodId: 'pw-1', kind: 'knowledge' };
const secondaryFactor = { issuedAt: now, authenticatedAt: now, method: 'authenticator', methodId: 'totp-1', kind: 'possession' };

const build = (options: { challengeExists?: boolean; eligible?: { method: string; methodId: string }[]; authenticated?: boolean } = {}) => {
    const mfaChallengeService = {
        peek: vi.fn().mockResolvedValue(
            options.challengeExists === false
                ? undefined
                : {
                      actor: { kind: 'user', actorId: ACTOR_ID },
                      eligibleFactors: options.eligible ?? [{ method: 'authenticator', methodId: 'totp-1' }],
                  },
        ),
    };
    const mfaOrchestrator = {
        completeMfa: vi.fn().mockResolvedValue({ actor: { kind: 'user', actorId: ACTOR_ID }, primaryFactor, secondaryFactor }),
        issueOrChallenge: vi.fn(),
    };
    const sessionService = {
        createSession: vi.fn().mockResolvedValue({ sessionToken: SESSION_TOKEN }),
        issueTokenForSession: vi.fn().mockResolvedValue(TOKENS),
        rotateSession: vi.fn().mockResolvedValue({ session: { sessionToken: 'rotated' }, ...TOKENS }),
        updateSession: vi.fn().mockResolvedValue(undefined),
    };
    const sessionActivity = {
        buildLoginContextClaims: vi.fn().mockReturnValue({}),
        recordLoginSuccess: vi.fn().mockResolvedValue(undefined),
    };
    const authorizationContext = {
        actor: options.authenticated ? { kind: 'user', actorId: ACTOR_ID, sessionToken: 'current' } : { kind: 'anonymous' },
    };
    const actorsRepository = {
        listFactors: vi.fn().mockResolvedValue([{ method: 'authenticator', methodId: 'totp-1', kind: 'possession', label: 'Phone' }]),
    };

    const service = Object.create(AuthenticationService.prototype) as AuthenticationService;
    Object.assign(service, { mfaChallengeService, mfaOrchestrator, sessionService, sessionActivity, authorizationContext, actorsRepository });

    const submit = (code = '123456', methodId = 'totp-1') =>
        (service as any).handleAuthenticator({ grant_type: 'authenticator', code, mfa_challenge_id: CHALLENGE_ID, method_id: methodId });

    return { submit, service, mfaChallengeService, mfaOrchestrator, sessionService, sessionActivity };
};

const statusOf = async (promise: Promise<unknown>) => {
    const error = await promise.catch((e: unknown) => e);
    return IsHttpError(error) ? error.statusCode : undefined;
};

describe('the authenticator grant', () => {
    it('refuses a challenge that no longer exists before touching the orchestrator', async () => {
        const h = build({ challengeExists: false });

        expect(await statusOf(h.submit())).toBe(401);
        expect(h.mfaOrchestrator.completeMfa).not.toHaveBeenCalled();
    });

    it('refuses a factor the challenge never offered, so a leaked challenge id cannot probe factor ids', async () => {
        const h = build({ eligible: [{ method: 'authenticator', methodId: 'totp-1' }] });

        expect(await statusOf(h.submit('123456', 'somebody-elses-totp'))).toBe(401);
        expect(h.mfaOrchestrator.completeMfa).not.toHaveBeenCalled();
    });

    it('does not let a FIDO factor on the challenge stand in for an authenticator', async () => {
        const h = build({ eligible: [{ method: 'fido', methodId: 'key-1' }] });

        expect(await statusOf(h.submit('123456', 'key-1'))).toBe(401);
        expect(h.mfaOrchestrator.completeMfa).not.toHaveBeenCalled();
    });

    it('completes the challenge and mints a session carrying both factors', async () => {
        const h = build();

        await expect(h.submit()).resolves.toMatchObject({ result: 'token', accessToken: 'access' });

        expect(h.mfaOrchestrator.completeMfa).toHaveBeenCalledWith(CHALLENGE_ID, { method: 'authenticator', methodId: 'totp-1', code: '123456' });
        expect(h.sessionService.createSession).toHaveBeenCalledWith(ACTOR_ID, expect.any(Object), [primaryFactor, secondaryFactor]);
        expect(h.sessionActivity.recordLoginSuccess).toHaveBeenCalledWith(expect.objectContaining({ actorId: ACTOR_ID, mfaSatisfied: true }));
    });

    it('rotates the current session instead of minting a new one when the caller is already signed in', async () => {
        // Step-up: a signed-in operator re-verifying to remove or add a factor. The pre-elevation
        // token has to die, which is what rotation buys and a fresh session would not.
        const h = build({ authenticated: true });

        await expect(h.submit()).resolves.toMatchObject({ result: 'token' });

        expect(h.sessionService.rotateSession).toHaveBeenCalledWith('current', expect.any(Object));
        expect(h.sessionService.updateSession).toHaveBeenCalledWith('rotated', ACTOR_ID, undefined, undefined, secondaryFactor);
        expect(h.sessionService.createSession).not.toHaveBeenCalled();
    });
});

describe('a password sign-in that needs a second factor', () => {
    it('answers mfa_required with the factors the challenge offers, and mints nothing', async () => {
        const h = build();
        h.mfaOrchestrator.issueOrChallenge.mockResolvedValue({
            kind: 'challenge',
            challenge: {
                challengeId: CHALLENGE_ID,
                expiresAt: now.plus({ minutes: 5 }),
                eligibleFactors: [{ method: 'authenticator', methodId: 'totp-1', kind: 'possession', label: 'Phone' }],
            },
        });

        const response = await (h.service as any).issueOrChallenge({ actor: { kind: 'user', actorId: ACTOR_ID }, primaryFactor });

        expect(response).toMatchObject({
            result: 'mfa_required',
            challengeId: CHALLENGE_ID,
            factors: [{ method: 'authenticator', methodId: 'totp-1', kind: 'possession', label: 'Phone' }],
        });
        expect(h.sessionService.createSession).not.toHaveBeenCalled();
    });

    it('hands the orchestrator every enrolled factor, label included, and mints a session on allow', async () => {
        const h = build();
        h.mfaOrchestrator.issueOrChallenge.mockResolvedValue({ kind: 'allow', actor: { kind: 'user', actorId: ACTOR_ID }, primaryFactor });

        const response = await (h.service as any).issueOrChallenge({ actor: { kind: 'user', actorId: ACTOR_ID }, primaryFactor });

        expect(h.mfaOrchestrator.issueOrChallenge).toHaveBeenCalledWith({ kind: 'user', actorId: ACTOR_ID }, primaryFactor, [
            { method: 'authenticator', methodId: 'totp-1', kind: 'possession', label: 'Phone' },
        ]);
        expect(response).toMatchObject({ result: 'token' });
        expect(h.sessionService.createSession).toHaveBeenCalledWith(ACTOR_ID, expect.any(Object), primaryFactor);
    });
});
