// The station's own MFA-required rule, which adds exactly one thing to the default: an email
// factor is not offered while there is nowhere to send mail from.
//
// It exists because of a deadlock found by walking a fresh install. Onboarding gives every operator
// an email factor beside their password and the default policy makes it eligible after one, so the
// first sign-in stopped at `mfa_required` naming a factor that could not be delivered — and the
// page that configures the mail server is behind that sign-in. The station arrived locked, and the
// only way in was psql.

import { describe, expect, it, vi } from 'vitest';
import { DateTime } from 'luxon';
import { Logger } from '@maroonedsoftware/logger';

import { DeadairMfaRequiredPolicy } from '../../../src/modules/authentication/mfa.required.policy.js';
import { MailService } from '../../../src/modules/mail/mail.service.js';

const ACTOR_ID = '11111111-1111-4111-8111-111111111111';
const now = DateTime.utc();

const password = { issuedAt: now, authenticatedAt: now, method: 'password' as const, methodId: 'pw-1', kind: 'knowledge' as const };
const emailFactor = { method: 'email' as const, methodId: 'email-1', kind: 'possession' as const };
const authenticatorFactor = { method: 'authenticator' as const, methodId: 'totp-1', kind: 'possession' as const };
const passwordFactor = { method: 'password' as const, methodId: 'pw-1', kind: 'knowledge' as const };

const build = (mailConfigured: boolean) => {
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger;
    const mailService = { isConfigured: () => mailConfigured } as unknown as MailService;
    return { policy: new DeadairMfaRequiredPolicy(mailService, logger), logger };
};

const evaluate = async (mailConfigured: boolean, availableFactors: unknown[]) => {
    const { policy, logger } = build(mailConfigured);
    const result = await policy.evaluate(
        { actor: { kind: 'user', actorId: ACTOR_ID }, primaryFactor: password, availableFactors } as never,
        {} as never,
    );
    return { result, logger };
};

/** The default policy denies with `mfa_required` when something survives, and allows when nothing does. */
const requiredMethods = (result: { allowed?: boolean; details?: { eligibleFactors?: { method: string }[] } }): string[] | undefined =>
    result.allowed ? undefined : (result.details?.eligibleFactors ?? []).map(f => f.method);

describe('when the station has a mail server', () => {
    it('offers the email factor after a password, as the default does', async () => {
        const { result } = await evaluate(true, [passwordFactor, emailFactor]);

        expect(requiredMethods(result)).toEqual(['email']);
    });

    it('still offers an authenticator alongside it', async () => {
        const { result } = await evaluate(true, [passwordFactor, emailFactor, authenticatorFactor]);

        expect(requiredMethods(result)?.sort()).toEqual(['authenticator', 'email']);
    });
});

describe('when the station has nowhere to send mail', () => {
    // The deadlock: this is every onboarded operator on a fresh install.
    it('lets a password-and-email account through rather than offering a code it cannot send', async () => {
        const { result } = await evaluate(false, [passwordFactor, emailFactor]);

        expect(result.allowed).toBe(true);
    });

    // It weakens nothing an operator set up deliberately.
    it('still challenges an account with an authenticator', async () => {
        const { result } = await evaluate(false, [passwordFactor, emailFactor, authenticatorFactor]);

        expect(requiredMethods(result)).toEqual(['authenticator']);
    });

    // From outside, an account that stops asking for its second factor looks like the station
    // forgetting. This is the only place that records it was a decision.
    it('says in the log that it dropped one, and why', async () => {
        const { logger } = await evaluate(false, [passwordFactor, emailFactor]);

        expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('no mail server is configured'), expect.objectContaining({ dropped: 1 }));
    });

    it('says nothing when there was no email factor to drop', async () => {
        const { logger } = await evaluate(false, [passwordFactor, authenticatorFactor]);

        expect(logger.warn).not.toHaveBeenCalled();
    });
});
