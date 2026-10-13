// Inviting somebody into a role. Pinned here: only an admin, behind the step-up; only a hash and a
// sealed copy of the token are stored; an admin's link lives 48 hours and a listener's a week; a
// second invitation to one address withdraws the first; an address with an account is refused; and
// only an open invitation ever shows its link.

import { describe, expect, it, vi } from 'vitest';
import { DateTime } from 'luxon';
import { IsHttpError, httpError } from '@maroonedsoftware/errors';
import { ErrorCodes } from '@deadair/error-codes';

import { InvitationsService } from '../../../src/modules/users/invitations.service.js';
import { hashInvitationToken, invitationState } from '../../../src/modules/users/invitation.token.js';
import { AuthorizationContext, type UserActor } from '../../../src/modules/permissions/authorization.context.js';
import type { InvitationRow, InvitationsRepository, NewInvitation } from '../../../src/modules/users/invitations.repository.js';
import type { EmailFactorRepository } from '@maroonedsoftware/authentication';
import type { EncryptionProvider } from '@maroonedsoftware/encryption';
import type { StrongFactorGate } from '../../../src/modules/authentication/strong.factor.gate.js';
import type { MailService } from '../../../src/modules/mail/mail.service.js';
import { settingsConfig } from '../../utils/settings.config.js';

const ADMIN_ID = '11111111-1111-4111-8111-111111111111';
const NOW = DateTime.utc();

const actor = (roles: ReadonlyArray<'admin' | 'listener'>): UserActor => ({
    kind: 'user',
    sessionToken: 's',
    actorId: ADMIN_ID,
    factors: [],
    platformRoles: new Set(roles),
});

const row = (overrides: Partial<InvitationRow> = {}): InvitationRow => ({
    id: '22222222-2222-4222-8222-222222222222',
    createdAt: NOW,
    email: 'sam@friends.test',
    role: 'listener',
    state: 'pending',
    tokenHash: 'h',
    tokenSealed: 'sealed:di_secret',
    expiresAt: NOW.plus({ days: 7 }),
    invitedBy: ADMIN_ID,
    acceptedAt: null,
    acceptedBy: null,
    revokedAt: null,
    revokedBy: null,
    inviterEmail: 'admin@deadair.test',
    ...overrides,
});

function build(
    options: { roles?: ReadonlyArray<'admin' | 'listener'>; existingAccount?: boolean; rows?: InvitationRow[]; mail?: boolean; origin?: string } = {},
) {
    const created: NewInvitation[] = [];
    const invitations = {
        list: vi.fn(async () => options.rows ?? [row()]),
        get: vi.fn(async (id: string) => (options.rows ?? [row()]).find(candidate => candidate.id === id)),
        revokePendingFor: vi.fn(async () => undefined),
        revoke: vi.fn(async (id: string) => (options.rows ?? [row()]).find(candidate => candidate.id === id && candidate.state === 'pending')),
        create: vi.fn(async (invitation: NewInvitation) => {
            created.push(invitation);
            return row({ ...invitation, tokenSealed: invitation.tokenSealed });
        }),
    };
    const emailFactors = { findFactor: vi.fn(async () => (options.existingAccount ? { id: 'f-1', actorId: 'u-9' } : undefined)) };
    const encryption = { encrypt: (value: string) => `sealed:${value}`, decrypt: (value: string) => value.replace(/^sealed:/, '') };
    const strongFactorGate = { assertRecentIfAnyEnrolled: vi.fn(async () => undefined) };
    const mail = {
        assertConfigured: vi.fn(() => {
            if (options.mail === false) throw httpError(503).withDetails({ message: 'Email is not configured.' });
        }),
        send: vi.fn(async () => undefined),
    };
    const service = new InvitationsService(
        invitations as unknown as InvitationsRepository,
        emailFactors as unknown as EmailFactorRepository,
        encryption as unknown as EncryptionProvider,
        strongFactorGate as unknown as StrongFactorGate,
        new AuthorizationContext(actor(options.roles ?? ['admin'])),
        mail as unknown as MailService,
        settingsConfig(options.origin === undefined ? { SPA_BASE_URL: 'https://radio.example/' } : { SPA_BASE_URL: options.origin }).config,
    );
    return { service, invitations, created, strongFactorGate, mail };
}

const codeOf = async (promise: Promise<unknown>) => {
    const error = await promise.catch((e: unknown) => e);
    return IsHttpError(error) ? { status: error.statusCode, code: (error.details as { code?: string } | undefined)?.code } : undefined;
};

describe('InvitationsService.create', () => {
    it('refuses anybody who is not an admin, before the step-up', async () => {
        const h = build({ roles: ['listener'] });
        await expect(h.service.create({ email: 'sam@friends.test', role: 'listener' })).rejects.toSatisfy(IsHttpError);
        expect(h.strongFactorGate.assertRecentIfAnyEnrolled).not.toHaveBeenCalled();
    });

    it('stores only a hash and a sealed copy of the token, and answers the link', async () => {
        const h = build();

        const invitation = await h.service.create({ email: ' sam@friends.test ', role: 'listener' });

        const [stored] = h.created;
        expect(invitation.token).toMatch(/^di_[A-Za-z0-9_-]{43}$/);
        expect(stored!.tokenHash).toBe(hashInvitationToken(invitation.token!));
        expect(stored!.tokenSealed).toBe(`sealed:${invitation.token}`);
        expect(JSON.stringify(stored)).not.toContain(`"${invitation.token}"`);
        expect(stored!.email).toBe('sam@friends.test');
        expect(stored!.invitedBy).toBe(ADMIN_ID);
    });

    it("gives an admin's link 48 hours and a listener's a week", async () => {
        const h = build();
        await h.service.create({ email: 'boss@friends.test', role: 'admin' });
        await h.service.create({ email: 'sam@friends.test', role: 'listener' });

        const [admin, listener] = h.created;
        expect(Math.round(admin!.expiresAt.diffNow('hours').hours)).toBe(48);
        expect(Math.round(listener!.expiresAt.diffNow('days').days)).toBe(7);
    });

    it('withdraws an open invitation to the same address first, which is how one is sent again', async () => {
        const h = build();

        await h.service.create({ email: 'sam@friends.test', role: 'listener' });

        expect(h.invitations.revokePendingFor).toHaveBeenCalledWith('sam@friends.test', ADMIN_ID);
        expect(h.invitations.revokePendingFor.mock.invocationCallOrder[0]).toBeLessThan(h.invitations.create.mock.invocationCallOrder[0]!);
    });

    it('refuses an address that already has an account', async () => {
        const h = build({ existingAccount: true });

        expect(await codeOf(h.service.create({ email: 'sam@friends.test', role: 'listener' }))).toEqual({
            status: 409,
            code: ErrorCodes.INVITATION_ALREADY_MEMBER,
        });
        expect(h.invitations.create).not.toHaveBeenCalled();
    });
});

describe('InvitationsService.create, sending the link', () => {
    it('emails the link at the deployed address, who sent it, and until when', async () => {
        const h = build();

        const invitation = await h.service.create({ email: 'sam@friends.test', role: 'listener', send: true });

        expect(h.mail.send).toHaveBeenCalledWith({
            to: 'sam@friends.test',
            template: 'Invitation',
            data: expect.objectContaining({
                link: `https://radio.example/invite#${invitation.token}`,
                role: 'listener',
                inviter: 'admin@deadair.test',
            }),
        });
    });

    it('sends nothing unless asked', async () => {
        const h = build();
        await h.service.create({ email: 'sam@friends.test', role: 'listener' });
        expect(h.mail.send).not.toHaveBeenCalled();
    });

    it('makes nothing when asked to email with no mail server', async () => {
        const h = build({ mail: false });

        expect(await codeOf(h.service.create({ email: 'sam@friends.test', role: 'listener', send: true }))).toMatchObject({ status: 503 });
        expect(h.invitations.create).not.toHaveBeenCalled();
    });

    it('makes nothing when asked to email with no deployed address to point the link at', async () => {
        const h = build({ origin: '' });

        expect(await codeOf(h.service.create({ email: 'sam@friends.test', role: 'listener', send: true }))).toMatchObject({ status: 409 });
        expect(h.invitations.create).not.toHaveBeenCalled();
    });
});

describe('InvitationsService.list', () => {
    it('shows the link of an open invitation and of nothing else', async () => {
        const h = build({
            rows: [
                row({ id: 'a0000000-0000-4000-8000-000000000001' }),
                row({ id: 'a0000000-0000-4000-8000-000000000002', state: 'accepted', acceptedAt: NOW }),
                row({ id: 'a0000000-0000-4000-8000-000000000003', state: 'revoked', revokedAt: NOW }),
                row({ id: 'a0000000-0000-4000-8000-000000000004', expiresAt: NOW.minus({ minutes: 1 }) }),
            ],
        });

        const { data } = await h.service.list();

        expect(data.map(invitation => [invitation.state, invitation.token])).toEqual([
            ['pending', 'di_secret'],
            ['accepted', undefined],
            ['revoked', undefined],
            ['expired', undefined],
        ]);
        expect(data[0]!.invitedBy).toBe('admin@deadair.test');
    });
});

describe('InvitationsService.revoke', () => {
    it('withdraws an open invitation', async () => {
        const h = build();
        await expect(h.service.revoke('22222222-2222-4222-8222-222222222222')).resolves.toMatchObject({ email: 'sam@friends.test' });
        expect(h.invitations.revoke).toHaveBeenCalledWith('22222222-2222-4222-8222-222222222222', ADMIN_ID);
    });

    it('answers 404 for an unknown invitation and 409 for one already used or withdrawn', async () => {
        const h = build({ rows: [row({ state: 'accepted', acceptedAt: NOW })] });
        expect(await codeOf(h.service.revoke('33333333-3333-4333-8333-333333333333'))).toEqual({ status: 404, code: undefined });
        expect(await codeOf(h.service.revoke('22222222-2222-4222-8222-222222222222'))).toEqual({
            status: 409,
            code: ErrorCodes.INVITATION_NOT_PENDING,
        });
    });
});

describe('invitationState', () => {
    it('reads a pending invitation past its time as expired, and leaves every other state alone', () => {
        expect(invitationState({ state: 'pending', expiresAt: NOW.minus({ seconds: 1 }) }, NOW)).toBe('expired');
        expect(invitationState({ state: 'pending', expiresAt: NOW.plus({ seconds: 1 }) }, NOW)).toBe('pending');
        expect(invitationState({ state: 'accepted', expiresAt: NOW.minus({ days: 1 }) }, NOW)).toBe('accepted');
    });
});
