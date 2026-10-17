// Changing a password while signed in. What is pinned here is the proof each case asks for (the
// current password, or a sign-in link used moments ago, and the strong-factor gate on top of either),
// that a wrong current password answers 400 rather than a 401 the console would read as signed out,
// that every other session is signed out, and that the notice goes after the commit and can never
// cost the change.

import { describe, expect, it, vi } from 'vitest';
import { DateTime } from 'luxon';
import { httpError, IsHttpError } from '@maroonedsoftware/errors';
import type { EmailFactorService, PasswordFactorService } from '@maroonedsoftware/authentication';
import type { Logger } from '@maroonedsoftware/logger';
import type { PolicyService } from '@maroonedsoftware/policies';

import { PasswordChangeService } from '../../../src/modules/authentication/password.change.service.js';
import { StrongFactorGate } from '../../../src/modules/authentication/strong.factor.gate.js';
import type { AuthorizationContext } from '../../../src/modules/permissions/authorization.context.js';
import type { ActorsRepository } from '../../../src/modules/authentication/repositories/actors.repository.js';
import type { SessionActivityService } from '../../../src/modules/authentication/session.activity.service.js';
import type { MailService } from '../../../src/modules/mail/mail.service.js';
import type { AfterCommit } from '../../../src/modules/data/after.commit.js';

const ACTOR_ID = '11111111-1111-4111-8111-111111111111';
const SESSION = 'session-1';

type SessionFactor = { method: string; authenticatedAt: DateTime };

const build = (
    options: {
        hasPassword?: boolean;
        sessionFactors?: SessionFactor[];
        enrolled?: { method: string }[];
        stepUpDenied?: boolean;
        verifyFails?: 401 | 429;
        mailConfigured?: boolean;
        emails?: string[];
        sendFails?: boolean;
    } = {},
) => {
    const actor = {
        kind: 'user' as const,
        actorId: ACTOR_ID,
        sessionToken: SESSION,
        factors: (options.sessionFactors ?? [{ method: 'password', authenticatedAt: DateTime.utc().minus({ hours: 2 }) }]).map(f => ({
            ...f,
            issuedAt: f.authenticatedAt,
            methodId: `${f.method}-1`,
            kind: 'knowledge',
        })),
    };
    const authorizationContext = {
        requireAuthentication: vi.fn(() => ({ actorId: ACTOR_ID, sessionToken: SESSION })),
        requireUser: vi.fn(() => actor),
    };
    const passwordFactorService = {
        getFactor: vi.fn(async () => (options.hasPassword === false ? undefined : { id: ACTOR_ID, actorId: ACTOR_ID, active: true })),
        verifyPassword: vi.fn(async () => {
            if (options.verifyFails) throw httpError(options.verifyFails);
            return { id: ACTOR_ID };
        }),
        updatePasswordFactor: vi.fn().mockResolvedValue({ id: ACTOR_ID }),
        createPasswordFactor: vi.fn().mockResolvedValue({ id: ACTOR_ID }),
    };
    const emailFactorService = {
        listFactors: vi.fn(async () => (options.emails ?? ['me@example.com']).map((value, i) => ({ id: `email-${i}`, value, active: true }))),
    };
    const actorsRepository = { listFactors: vi.fn().mockResolvedValue(options.enrolled ?? [{ method: 'password' }, { method: 'email' }]) };
    const policyService = {
        assert: vi.fn(async () => {
            if (options.stepUpDenied) throw httpError(403).withDetails({ kind: 'step_up_required' });
        }),
    };
    const sessionActivity = { revokeAllOtherSessions: vi.fn().mockResolvedValue(2) };
    const mailService = {
        isConfigured: vi.fn(() => options.mailConfigured !== false),
        send: vi.fn(async () => {
            if (options.sendFails) throw new Error('smtp refused');
        }),
    };
    const pending: (() => Promise<void>)[] = [];
    const afterCommit = { add: vi.fn((work: () => Promise<void>) => pending.push(work)) };
    const logger = { warn: vi.fn() };

    const service = new PasswordChangeService(
        authorizationContext as unknown as AuthorizationContext,
        passwordFactorService as unknown as PasswordFactorService,
        emailFactorService as unknown as EmailFactorService,
        new StrongFactorGate(actorsRepository as unknown as ActorsRepository, policyService as unknown as PolicyService),
        sessionActivity as unknown as SessionActivityService,
        mailService as unknown as MailService,
        afterCommit as unknown as AfterCommit,
        logger as unknown as Logger,
    );
    const commit = async () => {
        for (const work of pending.splice(0)) await work();
    };

    return { service, passwordFactorService, policyService, sessionActivity, mailService, afterCommit, logger, commit };
};

const failureOf = async (promise: Promise<unknown>) => {
    const error = await promise.catch((e: unknown) => e);
    return IsHttpError(error) ? { status: error.statusCode, details: error.details as Record<string, unknown> | undefined } : undefined;
};

describe('changing a password', () => {
    it('checks the current password and replaces it through the reuse-checking update', async () => {
        const h = build();

        await h.service.setPassword({ password: 'a new long passphrase', currentPassword: 'the old one' });

        expect(h.passwordFactorService.verifyPassword).toHaveBeenCalledWith(ACTOR_ID, 'the old one');
        expect(h.passwordFactorService.updatePasswordFactor).toHaveBeenCalledWith(ACTOR_ID, 'a new long passphrase');
        expect(h.passwordFactorService.createPasswordFactor).not.toHaveBeenCalled();
    });

    it('refuses with 400 when the current password is missing, and changes nothing', async () => {
        const h = build();

        const failure = await failureOf(h.service.setPassword({ password: 'a new long passphrase' }));

        expect(failure?.status).toBe(400);
        expect(failure?.details).toHaveProperty('currentPassword');
        expect(h.passwordFactorService.updatePasswordFactor).not.toHaveBeenCalled();
        expect(h.sessionActivity.revokeAllOtherSessions).not.toHaveBeenCalled();
    });

    it('answers a wrong current password with 400, never the 401 the console reads as signed out', async () => {
        const h = build({ verifyFails: 401 });

        const failure = await failureOf(h.service.setPassword({ password: 'a new long passphrase', currentPassword: 'wrong' }));

        expect(failure?.status).toBe(400);
        expect(failure?.details).toHaveProperty('currentPassword');
        expect(h.passwordFactorService.updatePasswordFactor).not.toHaveBeenCalled();
    });

    it('passes the rate limiter through, so guessing the current password stops at 429', async () => {
        const h = build({ verifyFails: 429 });

        expect((await failureOf(h.service.setPassword({ password: 'a new long passphrase', currentPassword: 'guess' })))?.status).toBe(429);
    });

    it('lets a sign-in link used moments ago stand in for the current password, which is what a reset is', async () => {
        const h = build({ sessionFactors: [{ method: 'email', authenticatedAt: DateTime.utc().minus({ minutes: 3 }) }] });

        await h.service.setPassword({ password: 'a new long passphrase' });

        expect(h.passwordFactorService.verifyPassword).not.toHaveBeenCalled();
        expect(h.passwordFactorService.updatePasswordFactor).toHaveBeenCalledWith(ACTOR_ID, 'a new long passphrase');
    });

    it('does not let an old sign-in link stand in for it', async () => {
        const h = build({ sessionFactors: [{ method: 'email', authenticatedAt: DateTime.utc().minus({ minutes: 30 }) }] });

        expect((await failureOf(h.service.setPassword({ password: 'a new long passphrase' })))?.status).toBe(400);
    });

    it('asks for a recent strong factor once an authenticator is enrolled, even after a sign-in link', async () => {
        const h = build({
            enrolled: [{ method: 'password' }, { method: 'authenticator' }],
            sessionFactors: [{ method: 'email', authenticatedAt: DateTime.utc() }],
            stepUpDenied: true,
        });

        expect((await failureOf(h.service.setPassword({ password: 'a new long passphrase' })))?.status).toBe(403);
        expect(h.passwordFactorService.updatePasswordFactor).not.toHaveBeenCalled();
    });

    it('creates a password for an account that has none, with no current one to ask for', async () => {
        const h = build({ hasPassword: false });

        await h.service.setPassword({ password: 'a new long passphrase' });

        expect(h.passwordFactorService.verifyPassword).not.toHaveBeenCalled();
        expect(h.passwordFactorService.createPasswordFactor).toHaveBeenCalledWith(ACTOR_ID, 'a new long passphrase');
    });

    it('signs every other session out and keeps the one that asked', async () => {
        const h = build();

        await h.service.setPassword({ password: 'a new long passphrase', currentPassword: 'the old one' });

        expect(h.sessionActivity.revokeAllOtherSessions).toHaveBeenCalledWith(ACTOR_ID, SESSION);
    });
});

describe('the notice', () => {
    it('goes to every address on the account, after the commit', async () => {
        const h = build({ emails: ['me@example.com', 'also@example.com'] });

        await h.service.setPassword({ password: 'a new long passphrase', currentPassword: 'the old one' });
        expect(h.mailService.send).not.toHaveBeenCalled();
        await h.commit();

        expect(h.mailService.send).toHaveBeenCalledWith({ to: 'me@example.com', template: 'PasswordChanged', data: { added: false } });
        expect(h.mailService.send).toHaveBeenCalledWith({ to: 'also@example.com', template: 'PasswordChanged', data: { added: false } });
    });

    it('says a password was added when there was none', async () => {
        const h = build({ hasPassword: false });

        await h.service.setPassword({ password: 'a new long passphrase' });
        await h.commit();

        expect(h.mailService.send).toHaveBeenCalledWith({ to: 'me@example.com', template: 'PasswordChanged', data: { added: true } });
    });

    it('is skipped, not refused, on a station with no mail server', async () => {
        const h = build({ mailConfigured: false });

        await expect(h.service.setPassword({ password: 'a new long passphrase', currentPassword: 'the old one' })).resolves.toBeUndefined();

        expect(h.afterCommit.add).not.toHaveBeenCalled();
    });

    it('logs a refused send rather than failing', async () => {
        const h = build({ sendFails: true });

        await h.service.setPassword({ password: 'a new long passphrase', currentPassword: 'the old one' });
        await expect(h.commit()).resolves.toBeUndefined();

        expect(h.logger.warn).toHaveBeenCalledOnce();
    });
});
