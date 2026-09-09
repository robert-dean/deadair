// `/auth/login/start` and the two grants that finish what it starts: a magic link, and an emailed
// code bound to the device that asked for it. Neither `link` nor `code` was in the handler map, so
// both answered "Unsupported grant type" — the console had no passwordless sign-in at all, and
// `deploy/.env.example` has been promising one all along.
//
// The enumeration guard is what most of this file is about. The route takes an arbitrary address
// and no session, so anything that behaves differently for an address with an account is a public
// "does this person work here" endpoint: the challenge id, the expiry, the number of requests
// allowed, and whether anything at all is stored.

import { describe, expect, it, vi } from 'vitest';
import { DateTime, Duration } from 'luxon';
import { httpError, IsHttpError } from '@maroonedsoftware/errors';

import { AuthenticationService } from '../../../src/modules/authentication/authentication.service.js';

const ACTOR_ID = '11111111-1111-4111-8111-111111111111';
const EMAIL = 'someone@example.com';
const CHALLENGE_ID = 'email-challenge-1';

const build = (options: { factorExists?: boolean; active?: boolean; spaBaseUrl?: string; limited?: boolean; mailConfigured?: boolean } = {}) => {
    const emailFactorRepository = {
        findFactor: vi.fn().mockResolvedValue(
            options.factorExists === false ? undefined : { id: 'email-1', actorId: ACTOR_ID, active: options.active ?? true, value: EMAIL },
        ),
    };
    const emailFactorService = {
        issueEmailChallenge: vi.fn().mockResolvedValue({
            email: EMAIL,
            challengeId: CHALLENGE_ID,
            code: 'magic-token-abc',
            expiresAt: DateTime.utc().plus({ minutes: 30 }),
            issuedAt: DateTime.utc(),
            alreadyIssued: false,
        }),
        verifyEmailChallenge: vi.fn().mockResolvedValue({ id: 'email-1', actorId: ACTOR_ID, active: true }),
    };
    const emailFactorServiceOptions = {
        otpExpiration: Duration.fromObject({ minutes: 10 }),
        magiclinkExpiration: Duration.fromObject({ minutes: 30 }),
    };
    const mailService = {
        assertConfigured: vi.fn(() => {
            if (options.mailConfigured === false) throw httpError(503).withDetails({ mail: 'Email is not configured.' });
        }),
        send: vi.fn().mockResolvedValue(undefined),
    };
    const signInMailLimiter = {
        consume: vi.fn(async () => {
            if (options.limited) throw httpError(429).withDetails({ email: 'Too many sign-in emails' });
        }),
    };
    const pkceProvider = { storeChallenge: vi.fn().mockResolvedValue(undefined) };
    const mfaOrchestrator = {
        issueOrChallenge: vi.fn().mockResolvedValue({
            kind: 'allow',
            actor: { kind: 'user', actorId: ACTOR_ID },
            primaryFactor: { method: 'email', methodId: 'email-1', kind: 'possession' },
        }),
    };
    const actorsRepository = { listFactors: vi.fn().mockResolvedValue([{ method: 'email', methodId: 'email-1', kind: 'possession' }]) };
    const sessionService = {
        createSession: vi.fn().mockResolvedValue({ sessionToken: 'session' }),
        issueTokenForSession: vi.fn().mockResolvedValue({ accessToken: 'a', refreshToken: 'r', expiresIn: 900, tokenType: 'Bearer', scope: '' }),
    };
    const sessionActivity = { buildLoginContextClaims: vi.fn().mockReturnValue({}), recordLoginSuccess: vi.fn().mockResolvedValue(undefined) };

    const service = Object.create(AuthenticationService.prototype) as AuthenticationService;
    Object.assign(service, {
        options: { spaBaseUrl: options.spaBaseUrl ?? 'https://radio.example.com' },
        emailFactorRepository,
        emailFactorService,
        emailFactorServiceOptions,
        mailService,
        signInMailLimiter,
        pkceProvider,
        mfaOrchestrator,
        actorsRepository,
        sessionService,
        sessionActivity,
        authorizationContext: { actor: { kind: 'anonymous' } },
        responseCookieJar: { setRefreshToken: vi.fn() },
    });

    const startLink = () => (service as never as { handleLinkStartLogin: (r: unknown) => Promise<{ challengeId: string; expiresAt: DateTime }> }).handleLinkStartLogin({ grant_type: 'link', email: EMAIL });
    const startCode = () => (service as never as { handleCodeStartLogin: (r: unknown) => Promise<{ challengeId: string; expiresAt: DateTime }> }).handleCodeStartLogin({ grant_type: 'code', email: EMAIL, code_challenge: 'client-challenge' });
    const redeemLink = (link = 'magic-token-abc') => (service as never as { handleLink: (r: unknown) => Promise<unknown> }).handleLink({ grant_type: 'link', challenge_id: CHALLENGE_ID, link });

    return { startLink, startCode, redeemLink, emailFactorService, mailService, signInMailLimiter, pkceProvider, mfaOrchestrator };
};

const statusOf = async (promise: Promise<unknown>): Promise<number | undefined> => {
    const error = await promise.catch((e: unknown) => e);
    return IsHttpError(error) ? error.statusCode : undefined;
};

describe('starting a magic-link sign-in', () => {
    it('emails a link carrying both the token and the challenge it is bound to', async () => {
        const { startLink, mailService } = build();

        await startLink();

        expect(mailService.send).toHaveBeenCalledWith({
            to: EMAIL,
            template: 'SignInLink',
            data: { link: `https://radio.example.com/auth/callback?token=magic-token-abc&challenge_id=${CHALLENGE_ID}`, minutes: 30 },
        });
    });

    // Both halves are needed for a link opened on a phone and finished on a laptop: there is no
    // per-device verifier to resolve the challenge from.
    it('points the link at the console rather than at the API', async () => {
        const { startLink, mailService } = build({ spaBaseUrl: 'https://radio.example.com/' });

        await startLink();

        const [message] = mailService.send.mock.calls[0] as [{ data: { link: string } }];
        expect(message.data.link.startsWith('https://radio.example.com/auth/callback?')).toBe(true);
    });

    it('issues the challenge as a magic link, not as a code', async () => {
        const { startLink, emailFactorService } = build();

        await startLink();

        expect(emailFactorService.issueEmailChallenge).toHaveBeenCalledWith(ACTOR_ID, 'email-1', 'magiclink');
    });

    it('refuses rather than guessing when nothing said where the console is', async () => {
        const { startLink } = build({ spaBaseUrl: '' });

        expect(await statusOf(startLink())).toBe(500);
    });
});

describe('starting an emailed-code sign-in', () => {
    it('emails the code and binds the caller’s PKCE challenge to it', async () => {
        const { startCode, mailService, pkceProvider } = build();

        await startCode();

        expect(pkceProvider.storeChallenge).toHaveBeenCalledWith('client-challenge', CHALLENGE_ID, expect.anything());
        expect(mailService.send).toHaveBeenCalledWith(expect.objectContaining({ template: 'SignInCode' }));
    });

    it('issues the challenge as a code, not as a link', async () => {
        const { startCode, emailFactorService } = build();

        await startCode();

        expect(emailFactorService.issueEmailChallenge).toHaveBeenCalledWith(ACTOR_ID, 'email-1', 'code');
    });
});

// The route is unauthenticated and takes an arbitrary address. Anything that behaves differently
// for one with an account answers "does this person work here" to anyone who asks.
describe('an address with no account', () => {
    it('answers in the same shape, and sends nothing', async () => {
        const { startLink, mailService, emailFactorService } = build({ factorExists: false });

        const result = await startLink();

        expect(result.challengeId).toHaveLength(43);
        expect(mailService.send).not.toHaveBeenCalled();
        expect(emailFactorService.issueEmailChallenge).not.toHaveBeenCalled();
    });

    it('treats a deactivated factor the same as a missing one', async () => {
        const { startLink, mailService } = build({ active: false });

        const result = await startLink();

        expect(result.challengeId).toHaveLength(43);
        expect(mailService.send).not.toHaveBeenCalled();
    });

    // Echoing a pending challenge's own expiry is a second oracle: it is in the past relative to
    // `now + TTL`, so two requests would tell a real address from an invented one.
    it('dates the expiry from now, the way a real one is', async () => {
        const real = await build().startLink();
        const invented = await build({ factorExists: false }).startLink();

        expect(Math.abs(real.expiresAt.diff(invented.expiresAt).as('seconds'))).toBeLessThan(2);
    });

    it('stashes no PKCE challenge, since a stored key is a third way to answer the same question', async () => {
        const { startCode, pkceProvider } = build({ factorExists: false });

        await startCode();

        expect(pkceProvider.storeChallenge).not.toHaveBeenCalled();
    });

    // A limiter that only counted real addresses would answer through its own 429.
    it('costs the same allowance as a real one', async () => {
        const { startLink, signInMailLimiter } = build({ factorExists: false });

        await startLink();

        expect(signInMailLimiter.consume).toHaveBeenCalledWith(EMAIL);
    });
});

describe('the bound on sign-in mail', () => {
    it('refuses once an address has had enough, before the factor is even looked up', async () => {
        const { startLink, mailService } = build({ limited: true });

        expect(await statusOf(startLink())).toBe(429);
        expect(mailService.send).not.toHaveBeenCalled();
    });

    it('refuses a station that cannot send before issuing a challenge nobody will receive', async () => {
        const { startLink, emailFactorService } = build({ mailConfigured: false });

        expect(await statusOf(startLink())).toBe(503);
        expect(emailFactorService.issueEmailChallenge).not.toHaveBeenCalled();
    });
});

describe('redeeming a magic link', () => {
    it('verifies the token against the challenge it was issued with', async () => {
        const { redeemLink, emailFactorService } = build();

        await redeemLink();

        expect(emailFactorService.verifyEmailChallenge).toHaveBeenCalledWith(CHALLENGE_ID, 'magic-token-abc', 'magiclink');
    });

    // Without the expected method this route would accept a six-digit OTP, and it takes an
    // arbitrary `link` string — five guesses at six digits.
    it('will not accept a challenge that was issued as a code', async () => {
        const { redeemLink, emailFactorService } = build();
        emailFactorService.verifyEmailChallenge.mockRejectedValue(httpError(404).withDetails({ challengeId: 'not found' }));

        expect(await statusOf(redeemLink('123456'))).toBe(404);
    });

    // A link proves the inbox, which is one factor and not two.
    it('goes through the MFA policy, so an enrolled authenticator is still asked for', async () => {
        const { redeemLink, mfaOrchestrator } = build();

        await redeemLink();

        expect(mfaOrchestrator.issueOrChallenge).toHaveBeenCalledWith(
            { kind: 'user', actorId: ACTOR_ID },
            expect.objectContaining({ method: 'email', methodId: 'email-1', kind: 'possession' }),
            expect.anything(),
        );
    });
});
