// The `code` grant, which serves two flows that share nothing but a six-digit field: completing a
// pending MFA round with an emailed code, and signing in on one outright with PKCE standing in for
// a password. Neither was registered in the handler map, so both answered "Unsupported grant type"
// — which made the email factor `/auth/token` offers unsatisfiable, since this is the only grant
// that redeems one.
//
// Three things are worth pinning beyond the happy paths: the binding rule (exactly one proof of
// origin), that eligibility is checked before `completeMfa` consumes the code, and that the PKCE
// arm resolves the challenge from the verifier rather than from the body.

import { describe, expect, it, vi } from 'vitest';
import { DateTime } from 'luxon';
import { httpError, IsHttpError } from '@maroonedsoftware/errors';

import { AuthenticationService } from '../../../src/modules/authentication/authentication.service.js';

const ACTOR_ID = '11111111-1111-4111-8111-111111111111';
const MFA_CHALLENGE = 'mfa-1';
const EMAIL_CHALLENGE = 'email-challenge-1';
const VERIFIER = 'v'.repeat(43);

const now = DateTime.utc();
const primaryFactor = { issuedAt: now, authenticatedAt: now, method: 'password', methodId: 'pw-1', kind: 'knowledge' };
const secondaryFactor = { issuedAt: now, authenticatedAt: now, method: 'email', methodId: 'email-1', kind: 'possession' };

const build = (
    options: { challengeExists?: boolean; eligible?: { method: string; methodId: string }[]; verifierResolves?: boolean; verifyThrows?: unknown } = {},
) => {
    const mfaChallengeService = {
        peek: vi.fn().mockResolvedValue(
            options.challengeExists === false
                ? undefined
                : { actor: { kind: 'user', actorId: ACTOR_ID }, eligibleFactors: options.eligible ?? [{ method: 'email', methodId: 'email-1' }] },
        ),
    };
    const mfaOrchestrator = {
        completeMfa: vi.fn().mockResolvedValue({ actor: { kind: 'user', actorId: ACTOR_ID }, primaryFactor, secondaryFactor }),
        issueOrChallenge: vi.fn().mockResolvedValue({ kind: 'allow', actor: { kind: 'user', actorId: ACTOR_ID }, primaryFactor: secondaryFactor }),
    };
    const emailFactorService = {
        verifyEmailChallenge: vi.fn(async () => {
            if (options.verifyThrows) throw options.verifyThrows;
            return { id: 'email-1', actorId: ACTOR_ID, active: true };
        }),
    };
    const pkceProvider = {
        getVerifier: vi.fn().mockResolvedValue(options.verifierResolves === false ? null : EMAIL_CHALLENGE),
        deleteVerifier: vi.fn().mockResolvedValue(undefined),
    };
    const actorsRepository = { listFactors: vi.fn().mockResolvedValue([{ method: 'email', methodId: 'email-1', kind: 'possession' }]) };
    const sessionService = {
        createSession: vi.fn().mockResolvedValue({ sessionToken: 'session' }),
        issueTokenForSession: vi.fn().mockResolvedValue({ accessToken: 'a', refreshToken: 'r', expiresIn: 900, tokenType: 'Bearer', scope: '' }),
    };
    const sessionActivity = {
        buildLoginContextClaims: vi.fn().mockReturnValue({}),
        recordLoginSuccess: vi.fn().mockResolvedValue(undefined),
        recordFactorFailure: vi.fn().mockResolvedValue(undefined),
    };
    const authorizationContext = { actor: { kind: 'anonymous' } };
    const responseCookieJar = { setRefreshToken: vi.fn() };

    const service = Object.create(AuthenticationService.prototype) as AuthenticationService;
    Object.assign(service, {
        mfaChallengeService,
        mfaOrchestrator,
        emailFactorService,
        pkceProvider,
        actorsRepository,
        sessionService,
        sessionActivity,
        authorizationContext,
        responseCookieJar,
    });

    const submit = (body: Record<string, unknown>) => (service as never as { handleCode: (r: unknown) => Promise<unknown> }).handleCode({ grant_type: 'code', ...body });

    return { submit, mfaChallengeService, mfaOrchestrator, emailFactorService, pkceProvider, sessionActivity };
};

const statusOf = async (promise: Promise<unknown>): Promise<number | undefined> => {
    const error = await promise.catch((e: unknown) => e);
    return IsHttpError(error) ? error.statusCode : undefined;
};

// The two are different claims about who is asking, so a request carrying both has answered
// neither and one carrying neither has not asked.
describe('the code grant’s proof of origin', () => {
    it('refuses a request carrying both a verifier and an MFA challenge', async () => {
        const { submit } = build();

        expect(await statusOf(submit({ code: '123456', code_verifier: VERIFIER, mfa_challenge_id: MFA_CHALLENGE, challenge_id: EMAIL_CHALLENGE }))).toBe(400);
    });

    it('refuses a request carrying neither', async () => {
        const { submit } = build();

        expect(await statusOf(submit({ code: '123456' }))).toBe(400);
    });

    it('refuses an MFA completion that does not name the email challenge to redeem', async () => {
        const { submit } = build();

        expect(await statusOf(submit({ code: '123456', mfa_challenge_id: MFA_CHALLENGE }))).toBe(400);
    });
});

describe('completing an MFA round with an emailed code', () => {
    const body = { code: '123456', mfa_challenge_id: MFA_CHALLENGE, challenge_id: EMAIL_CHALLENGE };

    it('redeems the challenge and mints a two-factor session', async () => {
        const { submit, mfaOrchestrator } = build();

        await submit(body);

        expect(mfaOrchestrator.completeMfa).toHaveBeenCalledWith(MFA_CHALLENGE, {
            method: 'email',
            challengeId: EMAIL_CHALLENGE,
            code: '123456',
            issueMethod: 'code',
        });
    });

    // Without the expected method, a 30-minute magic-link token issued for a passwordless sign-in
    // could be spent here as if it were a 10-minute MFA code.
    it('insists the challenge was issued as a code, not as a magic link', async () => {
        const { submit, mfaOrchestrator } = build();

        await submit(body);

        expect(mfaOrchestrator.completeMfa).toHaveBeenCalledWith(MFA_CHALLENGE, expect.objectContaining({ issueMethod: 'code' }));
    });

    it('refuses a challenge that does not exist', async () => {
        const { submit, mfaOrchestrator } = build({ challengeExists: false });

        expect(await statusOf(submit(body))).toBe(401);
        expect(mfaOrchestrator.completeMfa).not.toHaveBeenCalled();
    });

    // `completeMfa` verifies the proof BEFORE checking it against the eligible list, and verifying
    // consumes the challenge — so without this check a code could be burned against a round that
    // never offered email, and the request would fail anyway.
    it('checks the challenge offers email before anything can consume the code', async () => {
        const { submit, mfaOrchestrator, emailFactorService } = build({ eligible: [{ method: 'authenticator', methodId: 'totp-1' }] });

        expect(await statusOf(submit(body))).toBe(401);
        expect(mfaOrchestrator.completeMfa).not.toHaveBeenCalled();
        expect(emailFactorService.verifyEmailChallenge).not.toHaveBeenCalled();
    });

    it('records a refused code against the actor, as the password path records a refused password', async () => {
        const { submit, mfaOrchestrator, sessionActivity } = build();
        mfaOrchestrator.completeMfa.mockRejectedValue(httpError(400).withDetails({ code: 'invalid code' }));

        await submit(body).catch(() => undefined);

        expect(sessionActivity.recordFactorFailure).toHaveBeenCalledWith(
            expect.objectContaining({ factorType: 'email', actorId: ACTOR_ID, lastReason: 'invalid_code' }),
        );
    });

    it('tells a lockout apart from a wrong code in the activity it records', async () => {
        const { submit, mfaOrchestrator, sessionActivity } = build();
        mfaOrchestrator.completeMfa.mockRejectedValue(httpError(429).withDetails({ code: 'too many attempts' }));

        await submit(body).catch(() => undefined);

        expect(sessionActivity.recordFactorFailure).toHaveBeenCalledWith(expect.objectContaining({ lastReason: 'too_many_attempts' }));
    });

    // A mailer outage is not somebody failing a factor, and counting it as one fills the operator's
    // activity feed with their own infrastructure.
    it('records nothing for a server-side failure', async () => {
        const { submit, mfaOrchestrator, sessionActivity } = build();
        mfaOrchestrator.completeMfa.mockRejectedValue(httpError(503));

        await submit(body).catch(() => undefined);

        expect(sessionActivity.recordFactorFailure).not.toHaveBeenCalled();
    });
});

describe('signing in outright with an emailed code', () => {
    const body = { code: '123456', code_verifier: VERIFIER };

    it('resolves the challenge from the verifier rather than from the body', async () => {
        const { submit, pkceProvider, emailFactorService } = build();

        await submit({ ...body, challenge_id: 'somebody-elses-challenge' });

        expect(pkceProvider.getVerifier).toHaveBeenCalledWith(VERIFIER);
        expect(emailFactorService.verifyEmailChallenge).toHaveBeenCalledWith(EMAIL_CHALLENGE, '123456', 'code');
    });

    it('refuses when the verifier resolves to nothing', async () => {
        const { submit, emailFactorService } = build({ verifierResolves: false });

        expect(await statusOf(submit(body))).toBe(401);
        expect(emailFactorService.verifyEmailChallenge).not.toHaveBeenCalled();
    });

    it('spends the verifier, so the same code cannot be replayed', async () => {
        const { submit, pkceProvider } = build();

        await submit(body);

        expect(pkceProvider.deleteVerifier).toHaveBeenCalledWith(VERIFIER);
    });

    it('leaves the verifier alone when the code was wrong, so the person can try again', async () => {
        const { submit, pkceProvider } = build({ verifyThrows: httpError(400).withDetails({ code: 'invalid code' }) });

        await submit(body).catch(() => undefined);

        expect(pkceProvider.deleteVerifier).not.toHaveBeenCalled();
    });

    // An emailed code is a PRIMARY factor here, so an account with an authenticator still has to
    // produce it rather than being signed straight in.
    it('goes through the MFA policy rather than straight to a token', async () => {
        const { submit, mfaOrchestrator } = build();

        await submit(body);

        expect(mfaOrchestrator.issueOrChallenge).toHaveBeenCalledWith(
            { kind: 'user', actorId: ACTOR_ID },
            expect.objectContaining({ method: 'email', methodId: 'email-1', kind: 'possession' }),
            expect.anything(),
        );
    });
});
