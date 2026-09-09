// The email arm of `startFactorChallenge`: the half of email MFA that issues a code and gets it to
// the person waiting. Everything upstream of it already existed — `MfaOrchestrator.issueFactorChallenge`
// has answered `email` all along, handing back the recipient and the code for the caller to deliver
// — and this station had no way to deliver anything, so the arm was never written and the switch
// fell through to a 400 that read like a malformed body.
//
// The ordering assertion is the one worth having. `issueEmailChallenge` is idempotent per actor,
// factor and method for the life of the challenge, so issuing before checking that mail works
// leaves a code cached and undelivered, and every retry for the next ten minutes hands back that
// same unsent code.

import { describe, expect, it, vi } from 'vitest';
import { DateTime, Duration } from 'luxon';
import { httpError, IsHttpError } from '@maroonedsoftware/errors';

import { AuthenticationService } from '../../../src/modules/authentication/authentication.service.js';

const ACTOR_ID = '11111111-1111-4111-8111-111111111111';
const CHALLENGE_ID = 'mfa-challenge';
const EXPIRES_AT = DateTime.utc().plus({ minutes: 10 });

const build = (
    options: { challengeExists?: boolean; eligible?: { method: string; methodId: string }[]; mailConfigured?: boolean; alreadyIssued?: boolean } = {},
) => {
    const mfaChallengeService = {
        peek: vi.fn().mockResolvedValue(
            options.challengeExists === false
                ? undefined
                : {
                      actor: { kind: 'user', actorId: ACTOR_ID },
                      eligibleFactors: options.eligible ?? [{ method: 'email', methodId: 'email-1', kind: 'possession' }],
                  },
        ),
    };
    const mfaOrchestrator = {
        issueFactorChallenge: vi.fn().mockResolvedValue({
            method: 'email',
            challengeId: 'email-challenge-1',
            expiresAt: EXPIRES_AT,
            alreadyIssued: options.alreadyIssued ?? false,
            issueMethod: 'code',
            emailAddress: 'someone@example.com',
            code: '123456',
        }),
    };
    const mailService = {
        assertConfigured: vi.fn(() => {
            if (options.mailConfigured === false)
                throw httpError(503).withDetails({ mail: 'Email is not configured. Set a mail server under Settings → Mail.' });
        }),
        send: vi.fn().mockResolvedValue(undefined),
    };
    const emailFactorServiceOptions = { otpExpiration: Duration.fromObject({ minutes: 10 }) };

    const service = Object.create(AuthenticationService.prototype) as AuthenticationService;
    Object.assign(service, { mfaChallengeService, mfaOrchestrator, mailService, emailFactorServiceOptions });

    const start = () => service.startFactorChallenge({ method: 'email', mfa_challenge_id: CHALLENGE_ID });

    return { start, service, mfaChallengeService, mfaOrchestrator, mailService };
};

const statusOf = async (promise: Promise<unknown>): Promise<number | undefined> => {
    const error = await promise.catch((e: unknown) => e);
    return IsHttpError(error) ? error.statusCode : undefined;
};

describe('starting an email factor challenge', () => {
    it('issues against the factor the challenge offered, not one the caller named', async () => {
        const { start, mfaOrchestrator } = build();

        await start();

        expect(mfaOrchestrator.issueFactorChallenge).toHaveBeenCalledWith(CHALLENGE_ID, {
            method: 'email',
            methodId: 'email-1',
            issueMethod: 'code',
        });
    });

    it('emails the code to the address the orchestrator resolved', async () => {
        const { start, mailService } = build();

        await start();

        expect(mailService.send).toHaveBeenCalledWith({
            to: 'someone@example.com',
            template: 'SignInCode',
            data: { code: '123456', minutes: 10 },
        });
    });

    it('answers with the challenge id to echo back on the code grant, and never the address', async () => {
        const { start } = build();

        const result = await start();

        expect(result).toEqual({ method: 'email', email_challenge_id: 'email-challenge-1', expires_at: expect.anything() });
        expect(JSON.stringify(result)).not.toContain('someone@example.com');
    });

    // "Send it again" is the whole reason a person presses the button twice, and the flag means the
    // code is unchanged rather than that it arrived.
    it('sends again on a repeat, because alreadyIssued means unchanged and not delivered', async () => {
        const { start, mailService } = build({ alreadyIssued: true });

        await start();

        expect(mailService.send).toHaveBeenCalledWith(expect.objectContaining({ data: { code: '123456', minutes: 10 } }));
    });

    it('refuses a challenge that does not exist, without issuing anything', async () => {
        const { start, mfaOrchestrator } = build({ challengeExists: false });

        expect(await statusOf(start())).toBe(401);
        expect(mfaOrchestrator.issueFactorChallenge).not.toHaveBeenCalled();
    });

    it('refuses when the challenge offers no email factor', async () => {
        const { start, mfaOrchestrator } = build({ eligible: [{ method: 'authenticator', methodId: 'totp-1' }] });

        expect(await statusOf(start())).toBe(404);
        expect(mfaOrchestrator.issueFactorChallenge).not.toHaveBeenCalled();
    });

    it('refuses with a 503 when the station cannot send mail', async () => {
        const { start } = build({ mailConfigured: false });

        expect(await statusOf(start())).toBe(503);
    });

    // The point of checking first: an issued challenge is cached and idempotent, so issuing and
    // then failing to send strands the operator on a code that will never arrive and cannot be
    // reissued until it expires.
    it('checks mail BEFORE issuing, so a refusal leaves no undeliverable code behind', async () => {
        const { start, mfaOrchestrator } = build({ mailConfigured: false });

        await start().catch(() => undefined);

        expect(mfaOrchestrator.issueFactorChallenge).not.toHaveBeenCalled();
    });

    it('refuses if the orchestrator answers for a different method than it was asked about', async () => {
        const { start, mfaOrchestrator } = build();
        mfaOrchestrator.issueFactorChallenge.mockResolvedValue({ method: 'phone', challengeId: 'p1', expiresAt: EXPIRES_AT });

        expect(await statusOf(start())).toBe(500);
    });
});
