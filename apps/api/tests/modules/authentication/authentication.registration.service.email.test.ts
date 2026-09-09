// The two places the station confirms an address: registering a whole login, and adding an email
// factor to an account that already exists. Both had their send commented out since the module was
// ported, so both issued a code and delivered nothing — a registration that could never be
// completed and gave no sign of why.
//
// The two answer a repeat DIFFERENTLY, and that is the half worth pinning. `registerEmailFactor`
// upstream is idempotent for the life of the pending registration and hands back the same code, so
// the question is whether a second call is a duplicate to suppress or a resend to honour, and the
// route decides it: registering a login takes no session, so a repeat is somebody typing an address
// that is not theirs and one message per window is the bound; enrolling a factor is behind a
// session and behind a "send it again" button, so a repeat is the operator saying the first did not
// arrive, and answering that with silence is the one answer they cannot tell from success.
//
// Both refuse before issuing when there is nowhere to send from, which is not the same as letting
// the send fail: a registration cached against a failed send keeps handing back that same
// undelivered code for ten minutes, so the attempt made just before the operator configures a mail
// server would otherwise poison the window they configure it in.
//
// Built off the prototype like the other authentication tests, with only the collaborators these
// two paths touch.

import { describe, expect, it, vi } from 'vitest';
import { DateTime, Duration } from 'luxon';
import { httpError, IsHttpError } from '@maroonedsoftware/errors';

import { AuthenticationRegistrationService } from '../../../src/modules/authentication/authentication.registration.service.js';

const ACTOR_ID = '11111111-1111-4111-8111-111111111111';
const EXPIRES_AT = DateTime.utc().plus({ minutes: 10 });

const build = (options: { alreadyRegistered?: boolean; otpExpiration?: Duration; mailConfigured?: boolean; limited?: boolean } = {}) => {
    const emailFactorService = {
        registerEmailFactor: vi.fn().mockResolvedValue({
            registrationId: 'reg-1',
            code: '123456',
            expiresAt: EXPIRES_AT,
            issuedAt: DateTime.utc(),
            alreadyRegistered: options.alreadyRegistered ?? false,
        }),
    };
    const emailFactorServiceOptions = { otpExpiration: options.otpExpiration ?? Duration.fromObject({ minutes: 10 }) };
    const mailService = {
        send: vi.fn().mockResolvedValue(undefined),
        assertConfigured: vi.fn(() => {
            if (options.mailConfigured === false) {
                throw httpError(503).withDetails({ message: 'Email is not configured. Set a mail server under Settings → Mail.' });
            }
        }),
    };
    const signInMailLimiter = {
        consume: vi.fn(async () => {
            if (options.limited) throw httpError(429).withDetails({ email: 'Too many verification emails' });
        }),
    };
    const passwordFactorService = {
        ensurePasswordStrength: vi.fn().mockResolvedValue(undefined),
        registerPasswordFactor: vi.fn().mockResolvedValue(undefined),
    };
    const pkceProvider = { storeChallenge: vi.fn().mockResolvedValue(undefined) };
    const cacheProvider = {
        get: vi.fn().mockResolvedValue(null),
        set: vi.fn().mockResolvedValue(undefined),
        delete: vi.fn().mockResolvedValue(undefined),
    };

    const service = Object.create(AuthenticationRegistrationService.prototype) as AuthenticationRegistrationService;
    Object.assign(service, {
        emailFactorService,
        emailFactorServiceOptions,
        mailService,
        signInMailLimiter,
        passwordFactorService,
        pkceProvider,
        cacheProvider,
    });

    const enrol = (request: unknown = { method: 'email', value: 'someone@example.com', codeChallenge: 'challenge' }) =>
        (service as unknown as { registerEmailFactor: (a: string, r: unknown) => Promise<unknown> }).registerEmailFactor(ACTOR_ID, request);

    return { service, enrol, emailFactorService, mailService, signInMailLimiter, pkceProvider };
};

const statusOf = async (promise: Promise<unknown>) => {
    const error = await promise.catch((e: unknown) => e);
    return IsHttpError(error) ? error.statusCode : undefined;
};

describe('registering a login', () => {
    it('emails the code it just issued', async () => {
        const { service, mailService } = build();

        await service.registerLogin({ email: 'someone@example.com' });

        expect(mailService.send).toHaveBeenCalledWith({
            to: 'someone@example.com',
            template: 'VerifyEmail',
            data: { code: '123456', minutes: 10 },
        });
    });

    it('says how long the code lasts, from the same duration that expires it', async () => {
        const { service, mailService } = build({ otpExpiration: Duration.fromObject({ minutes: 25 }) });

        await service.registerLogin({ email: 'someone@example.com' });

        expect(mailService.send).toHaveBeenCalledWith(expect.objectContaining({ data: { code: '123456', minutes: 25 } }));
    });

    // Repeating the request must not repeat the message: the code that comes back is the one
    // already sent, and this route takes no session.
    it('sends nothing on a repeat, since the code is the one already in their inbox', async () => {
        const { service, mailService } = build({ alreadyRegistered: true });

        await service.registerLogin({ email: 'someone@example.com' });

        expect(mailService.send).not.toHaveBeenCalled();
    });

    it('still answers with the registration when it did not send', async () => {
        const { service } = build({ alreadyRegistered: true });

        const result = await service.registerLogin({ email: 'someone@example.com' });

        expect(result).toMatchObject({ registrationId: 'reg-1' });
    });

    // The send is the step with no undo. A registration cached and not delivered is a wait the
    // operator ends by asking again; a code delivered against a registration that failed to cache
    // verifies against nothing.
    it('sends only after the password half is registered', async () => {
        const { service, mailService } = build();
        const order: string[] = [];
        mailService.send.mockImplementation(async () => void order.push('send'));

        await service.registerLogin({ email: 'someone@example.com', password: 'a-strong-one' });

        expect(order).toEqual(['send']);
    });

    it('refuses with a 503 before issuing anything when there is nowhere to send from', async () => {
        const { service, emailFactorService } = build({ mailConfigured: false });

        expect(await statusOf(service.registerLogin({ email: 'someone@example.com' }))).toBe(503);
        expect(emailFactorService.registerEmailFactor).not.toHaveBeenCalled();
    });
});

describe('enrolling an email factor on an existing account', () => {
    it('emails the code', async () => {
        const { enrol, mailService } = build();

        await enrol();

        expect(mailService.send).toHaveBeenCalledWith({
            to: 'someone@example.com',
            template: 'VerifyEmail',
            data: { code: '123456', minutes: 10 },
        });
    });

    it('binds the PKCE challenge before it sends, since that is the half that can still fail', async () => {
        const { enrol, mailService, pkceProvider } = build();
        const order: string[] = [];
        pkceProvider.storeChallenge.mockImplementation(async () => void order.push('pkce'));
        mailService.send.mockImplementation(async () => void order.push('send'));

        await enrol();

        expect(order).toEqual(['pkce', 'send']);
    });

    // The console's "Send it again" is this call a second time. Answering it with a 200 and no
    // message is the failure the button exists to fix.
    it('sends again on a repeat, because a resend is what the operator asked for', async () => {
        const { enrol, mailService } = build({ alreadyRegistered: true });

        await enrol();

        expect(mailService.send).toHaveBeenCalledWith(expect.objectContaining({ data: { code: '123456', minutes: 10 } }));
    });

    // A second tab starting the enrolment over holds a verifier of its own. Binding only on a fresh
    // registration left that verifier unknown to the API, so the code that arrived verified against
    // nothing.
    it('binds a second attempt’s challenge too, not just the first', async () => {
        const { enrol, pkceProvider } = build({ alreadyRegistered: true });

        await enrol({ method: 'email', value: 'someone@example.com', codeChallenge: 'second-challenge' });

        expect(pkceProvider.storeChallenge).toHaveBeenCalledWith('second-challenge', 'reg-1', expect.anything());
    });

    it('refuses with a 503 before issuing anything when there is nowhere to send from', async () => {
        const { enrol, emailFactorService } = build({ mailConfigured: false });

        expect(await statusOf(enrol())).toBe(503);
        expect(emailFactorService.registerEmailFactor).not.toHaveBeenCalled();
    });

    // Behind a session, but the address is still whatever was typed: the bound is on the mailbox
    // being filled, not on the caller filling it.
    it('spends the address’s allowance before issuing, and refuses with a 429 when it is gone', async () => {
        const { enrol, emailFactorService, signInMailLimiter } = build({ limited: true });

        expect(await statusOf(enrol())).toBe(429);
        expect(signInMailLimiter.consume).toHaveBeenCalledWith('someone@example.com');
        expect(emailFactorService.registerEmailFactor).not.toHaveBeenCalled();
    });
});
