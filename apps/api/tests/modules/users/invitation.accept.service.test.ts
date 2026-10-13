// Accepting an invitation. Pinned here: every call spends the address's allowance before it looks
// anything up; a dead invitation is one 404; `details` and `start` change nothing, however often they
// are called (the mail-scanner case); a weak password is refused at the start, before any second step
// is set up; and `accept` makes the account with the id the second step was set up against, spends the
// invitation, and grants the role on the inviter's authority, in that order.

import { describe, expect, it, vi } from 'vitest';
import { DateTime } from 'luxon';
import { IsHttpError, httpError } from '@maroonedsoftware/errors';
import { ErrorCodes } from '@deadair/error-codes';

import { InvitationAcceptService } from '../../../src/modules/users/invitation.accept.service.js';
import { hashInvitationToken } from '../../../src/modules/users/invitation.token.js';
import { AuthorizationContext } from '../../../src/modules/permissions/authorization.context.js';
import type { InvitationRow } from '../../../src/modules/users/invitations.repository.js';
import { settingsConfig } from '../../utils/settings.config.js';

const TOKEN = 'di_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const INVITER = '11111111-1111-4111-8111-111111111111';
const NOW = DateTime.utc();
const CREDENTIAL = {
    id: 'c',
    rawId: 'c',
    type: 'public-key' as const,
    clientExtensionResults: {},
    response: { clientDataJSON: 'x', attestationObject: 'y' },
};

const invitation = (overrides: Partial<InvitationRow> = {}): InvitationRow => ({
    id: '22222222-2222-4222-8222-222222222222',
    createdAt: NOW,
    email: 'sam@friends.test',
    role: 'listener',
    state: 'pending',
    tokenHash: hashInvitationToken(TOKEN),
    tokenSealed: 's',
    expiresAt: NOW.plus({ days: 7 }),
    invitedBy: INVITER,
    acceptedAt: null,
    acceptedBy: null,
    revokedAt: null,
    revokedBy: null,
    inviterEmail: 'admin@deadair.test',
    ...overrides,
});

function build(options: { open?: InvitationRow | undefined; taken?: boolean; weak?: boolean; consumed?: boolean } = {}) {
    const calls: string[] = [];
    const store = new Map<string, string>();
    const open = 'open' in options ? options.open : invitation();
    const invitations = {
        openByHash: vi.fn(async (hash: string) => {
            calls.push('lookup');
            return open && open.tokenHash === hash ? open : undefined;
        }),
        consume: vi.fn(async () => {
            calls.push('consume');
            return options.consumed === false ? undefined : open;
        }),
    };
    const limiter = { consume: vi.fn(async () => void calls.push('limit')) };
    const actors = { create: vi.fn(async (_type: string, _active: boolean, id: string) => void calls.push(`actor:${id}`)) };
    const emailFactors = {
        findFactor: vi.fn(async () => (options.taken ? { id: 'f' } : undefined)),
        createFactor: vi.fn(async () => void calls.push('email')),
    };
    const passwordFactors = {
        ensurePasswordStrength: vi.fn(async () => {
            if (options.weak) throw httpError(400).withDetails({ password: 'This is a very common password' });
        }),
        createPasswordFactor: vi.fn(async () => void calls.push('password')),
    };
    const authenticatorFactors = {
        registerAuthenticatorFactor: vi.fn(async () => ({
            registrationId: 'reg-totp',
            secret: 'SECRET',
            uri: 'otpauth://x',
            qrCode: 'data:image/png;base64,',
        })),
        createAuthenticatorFactorFromRegistration: vi.fn(async () => void calls.push('authenticator')),
    };
    const fidoFactors = {
        registerFidoFactor: vi.fn(async () => ({
            registrationId: 'reg-fido',
            attestation: {
                rp: { id: 'radio.example', name: 'Night Owl FM' },
                user: { id: 'u', name: 'sam@friends.test', displayName: 'sam@friends.test' },
                challenge: 'c',
                pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
                attestation: 'none',
            },
        })),
        createFidoFactorFromRegistration: vi.fn(async () => void calls.push('passkey')),
    };
    const passkeyRelyingParty = { resolve: () => ({ rpId: 'radio.example', rpOrigin: 'https://radio.example', rpName: 'Night Owl FM' }) };
    const platformRoles = { assign: vi.fn(async (id: string, role: string, by: string) => void calls.push(`role:${role}:by:${by}`)) };
    const cache = {
        set: vi.fn(async (key: string, value: string) => void store.set(key, value)),
        get: vi.fn(async (key: string) => store.get(key)),
        delete: vi.fn(async (key: string) => void store.delete(key)),
    };
    const service = new InvitationAcceptService(
        invitations as never,
        limiter as never,
        actors as never,
        emailFactors as never,
        passwordFactors as never,
        authenticatorFactors as never,
        fidoFactors as never,
        passkeyRelyingParty as never,
        platformRoles as never,
        cache as never,
        new AuthorizationContext({ kind: 'anonymous' } as never, { clientAddress: '203.0.113.9' }),
        settingsConfig({ 'stream.title': 'Night Owl FM' }).config,
    );
    return { service, calls, store, invitations, limiter, actors, passwordFactors, authenticatorFactors, fidoFactors, platformRoles };
}

const statusOf = async (promise: Promise<unknown>) => {
    const error = await promise.catch((e: unknown) => e);
    return IsHttpError(error) ? { status: error.statusCode, code: (error.details as { code?: string } | undefined)?.code } : undefined;
};

describe('InvitationAcceptService.details', () => {
    it('says what the invitation is for, after spending the address allowance', async () => {
        const h = build();

        await expect(h.service.details({ token: TOKEN })).resolves.toMatchObject({
            email: 'sam@friends.test',
            role: 'listener',
            stationName: 'Night Owl FM',
        });
        expect(h.calls.slice(0, 2)).toEqual(['limit', 'lookup']);
        expect(h.limiter.consume).toHaveBeenCalledWith('203.0.113.9');
    });

    it('answers one 404 for any invitation that is not open', async () => {
        const h = build({ open: undefined });
        expect(await statusOf(h.service.details({ token: TOKEN }))).toMatchObject({ status: 404 });
    });
});

describe('InvitationAcceptService.start', () => {
    it('refuses a weak password before setting up any second step', async () => {
        const h = build({ weak: true });

        expect(await statusOf(h.service.start({ token: TOKEN, password: 'password1', method: 'authenticator' }))).toMatchObject({ status: 400 });
        expect(h.authenticatorFactors.registerAuthenticatorFactor).not.toHaveBeenCalled();
    });

    it('refuses an address that has gained an account since it was invited', async () => {
        const h = build({ taken: true });
        expect(await statusOf(h.service.start({ token: TOKEN, password: 'long enough', method: 'authenticator' }))).toEqual({
            status: 409,
            code: ErrorCodes.INVITATION_ALREADY_MEMBER,
        });
    });

    it('sets an authenticator up against a fresh account id, and saves nothing', async () => {
        const h = build();

        const setup = await h.service.start({ token: TOKEN, password: 'long enough', method: 'authenticator' });

        expect(setup).toMatchObject({ method: 'authenticator', registrationId: 'reg-totp', secret: 'SECRET' });
        const [actorId] = h.authenticatorFactors.registerAuthenticatorFactor.mock.calls[0] as unknown as [string];
        expect(JSON.parse(h.store.get('invitations:accept:reg-totp')!)).toEqual({ actorId, tokenHash: hashInvitationToken(TOKEN) });
        expect(h.actors.create).not.toHaveBeenCalled();
        expect(h.invitations.consume).not.toHaveBeenCalled();
    });

    it("sets a passkey up for the station's own address, named by the invited address", async () => {
        const h = build();

        await expect(h.service.start({ token: TOKEN, password: 'long enough', method: 'fido' })).resolves.toMatchObject({
            method: 'fido',
            registrationId: 'reg-fido',
        });
        expect(h.fidoFactors.registerFidoFactor).toHaveBeenCalledWith(expect.any(String), {
            userName: 'sam@friends.test',
            userDisplayName: 'sam@friends.test',
            rpId: 'radio.example',
            rpOrigin: 'https://radio.example',
            rpName: 'Night Owl FM',
        });
    });

    it('can be called again and again without spending the invitation, as a link scanner would', async () => {
        const h = build();
        for (let i = 0; i < 5; i++) await h.service.start({ token: TOKEN, password: 'long enough', method: 'authenticator' });
        await h.service.details({ token: TOKEN });

        expect(h.invitations.consume).not.toHaveBeenCalled();
        expect(h.actors.create).not.toHaveBeenCalled();
    });
});

describe('InvitationAcceptService.accept', () => {
    const started = async (h: ReturnType<typeof build>, method: 'authenticator' | 'fido' = 'authenticator') => {
        await h.service.start({ token: TOKEN, password: 'long enough', method });
        const register = method === 'authenticator' ? h.authenticatorFactors.registerAuthenticatorFactor : h.fidoFactors.registerFidoFactor;
        return (register.mock.calls[0] as unknown as [string])[0];
    };

    it('makes the account, spends the invitation, then writes its factors and role, in that order', async () => {
        const h = build();
        const actorId = await started(h);
        h.calls.length = 0;

        await expect(
            h.service.accept({ method: 'authenticator', token: TOKEN, password: 'long enough', registrationId: 'reg-totp', code: '123456' }),
        ).resolves.toEqual({ email: 'sam@friends.test', role: 'listener' });

        expect(h.calls).toEqual([
            'limit',
            'lookup',
            `actor:${actorId}`,
            'consume',
            'email',
            'password',
            'authenticator',
            `role:listener:by:${INVITER}`,
        ]);
        expect(h.store.has('invitations:accept:reg-totp')).toBe(false);
    });

    it('accepts with a passkey just the same', async () => {
        const h = build();
        await started(h, 'fido');

        await h.service.accept({ method: 'fido', token: TOKEN, password: 'long enough', registrationId: 'reg-fido', credential: CREDENTIAL });

        expect(h.fidoFactors.createFidoFactorFromRegistration).toHaveBeenCalledWith(expect.any(String), 'reg-fido', CREDENTIAL);
    });

    it('refuses a setup that was started for a different invitation, and makes nothing', async () => {
        const h = build();
        await started(h);

        expect(
            await statusOf(
                h.service.accept({ method: 'authenticator', token: 'di_other', password: 'long enough', registrationId: 'reg-totp', code: '1' }),
            ),
        ).toMatchObject({ status: 404 });
        expect(h.actors.create).not.toHaveBeenCalled();
    });

    it('stops when the invitation was spent by somebody else first', async () => {
        const h = build({ consumed: false });
        await started(h);

        expect(
            await statusOf(
                h.service.accept({ method: 'authenticator', token: TOKEN, password: 'long enough', registrationId: 'reg-totp', code: '123456' }),
            ),
        ).toMatchObject({ status: 404 });
        expect(h.authenticatorFactors.createAuthenticatorFactorFromRegistration).not.toHaveBeenCalled();
        expect(h.platformRoles.assign).not.toHaveBeenCalled();
    });

    it('lets a wrong code fail the whole request, before any role is granted', async () => {
        const h = build();
        await started(h);
        h.authenticatorFactors.createAuthenticatorFactorFromRegistration.mockRejectedValue(httpError(401));

        expect(
            await statusOf(
                h.service.accept({ method: 'authenticator', token: TOKEN, password: 'long enough', registrationId: 'reg-totp', code: '000000' }),
            ),
        ).toMatchObject({ status: 401 });
        expect(h.platformRoles.assign).not.toHaveBeenCalled();
    });
});
