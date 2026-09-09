// The two places the station confirms an address: registering a whole login, and adding an email
// factor to an account that already exists. Both had their send commented out since the module was
// ported, so both issued a code and delivered nothing — a registration that could never be
// completed and gave no sign of why.
//
// What is pinned is the send, the code it carries, and the one case that must NOT send: a repeat
// call. `registerEmailFactor` is idempotent for the life of the pending registration and hands back
// the same code, so a second send is a second copy of a code the person already has, and on an
// endpoint that takes no session it is somebody else's mail bomb.
//
// Built off the prototype like the other authentication tests, with only the collaborators these
// two paths touch.

import { describe, expect, it, vi } from 'vitest';
import { DateTime, Duration } from 'luxon';

import { AuthenticationRegistrationService } from '../../../src/modules/authentication/authentication.registration.service.js';

const ACTOR_ID = '11111111-1111-4111-8111-111111111111';
const EXPIRES_AT = DateTime.utc().plus({ minutes: 10 });

const build = (options: { alreadyRegistered?: boolean; otpExpiration?: Duration } = {}) => {
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
    const mailService = { send: vi.fn().mockResolvedValue(undefined) };
    const passwordFactorService = {
        ensurePasswordStrength: vi.fn().mockResolvedValue(undefined),
        registerPasswordFactor: vi.fn().mockResolvedValue(undefined),
    };
    const pkceProvider = { storeChallenge: vi.fn().mockResolvedValue(undefined) };
    const cacheProvider = { get: vi.fn().mockResolvedValue(null), set: vi.fn().mockResolvedValue(undefined), delete: vi.fn().mockResolvedValue(undefined) };

    const service = Object.create(AuthenticationRegistrationService.prototype) as AuthenticationRegistrationService;
    Object.assign(service, { emailFactorService, emailFactorServiceOptions, mailService, passwordFactorService, pkceProvider, cacheProvider });

    return { service, emailFactorService, mailService, pkceProvider };
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
    // already sent.
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
});

describe('registering an email factor on an existing account', () => {
    const request = { method: 'email' as const, value: 'someone@example.com', codeChallenge: 'challenge' };

    it('emails the code', async () => {
        const { service, mailService } = build();

        await (service as unknown as { registerEmailFactor: (a: string, r: unknown) => Promise<unknown> }).registerEmailFactor(ACTOR_ID, request);

        expect(mailService.send).toHaveBeenCalledWith({
            to: 'someone@example.com',
            template: 'VerifyEmail',
            data: { code: '123456', minutes: 10 },
        });
    });

    it('binds the PKCE challenge before it sends, since that is the half that can still fail', async () => {
        const { service, mailService, pkceProvider } = build();
        const order: string[] = [];
        pkceProvider.storeChallenge.mockImplementation(async () => void order.push('pkce'));
        mailService.send.mockImplementation(async () => void order.push('send'));

        await (service as unknown as { registerEmailFactor: (a: string, r: unknown) => Promise<unknown> }).registerEmailFactor(ACTOR_ID, request);

        expect(order).toEqual(['pkce', 'send']);
    });

    it('sends nothing on a repeat', async () => {
        const { service, mailService } = build({ alreadyRegistered: true });

        await (service as unknown as { registerEmailFactor: (a: string, r: unknown) => Promise<unknown> }).registerEmailFactor(ACTOR_ID, request);

        expect(mailService.send).not.toHaveBeenCalled();
    });
});
