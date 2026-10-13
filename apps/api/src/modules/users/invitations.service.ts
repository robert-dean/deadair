import { Injectable } from 'injectkit';
import { httpError } from '@maroonedsoftware/errors';
import { EncryptionProvider } from '@maroonedsoftware/encryption';
import { parseAndValidate } from '@maroonedsoftware/zod';
import { DateTime } from 'luxon';
import { ErrorCodes } from '@deadair/error-codes';
import { AuthorizationContext } from '#modules/permissions/authorization.context.js';
import { EmailFactorRepository } from '@maroonedsoftware/authentication';
import { StrongFactorGate } from '#modules/authentication/strong.factor.gate.js';
import { InvitationsRepository, type InvitationRow } from './invitations.repository.js';
import { INVITATION_LIFETIME, hashInvitationToken, invitationState, mintInvitationToken } from './invitation.token.js';
import { Invitation, InvitationList, type InvitationCreate } from './types/invitations.types.js';

/**
 * Inviting somebody into a role, for an admin.
 *
 * An invitation names the address the account will have and the role it will hold, and the link is
 * the only way to claim it. The token is stored as a hash and a sealed copy (the party pass's
 * pattern), so the console can show the link again while it is open and a read of the table alone
 * cannot claim anything.
 *
 * Making one is behind the recent-strong-factor step-up, as every change to who can do what is:
 * an invitation is an account waiting to be claimed, and an admin one is the whole station.
 */
@Injectable()
export class InvitationsService {
    constructor(
        private readonly invitations: InvitationsRepository,
        private readonly emailFactors: EmailFactorRepository,
        private readonly encryption: EncryptionProvider,
        private readonly strongFactorGate: StrongFactorGate,
        private readonly authz: AuthorizationContext,
    ) {}

    async list(): Promise<InvitationList> {
        this.authz.requirePlatformRole('admin');
        const now = DateTime.utc();
        return await parseAndValidate({ data: (await this.invitations.list()).map(row => this.toInvitation(row, now)) }, InvitationList);
    }

    /**
     * Invite `email` into `role`. An open invitation to the same address is withdrawn first, so this
     * is also how one is sent again, and there is never more than one live link for one person.
     */
    async create(body: InvitationCreate): Promise<Invitation> {
        const callerId = await this.beginWrite();
        const email = body.email.trim();

        if (await this.emailFactors.findFactor(email)) {
            throw httpError(409).withDetails({
                code: ErrorCodes.INVITATION_ALREADY_MEMBER,
                message: 'that address already has an account; change its role under People instead',
            });
        }

        await this.invitations.revokePendingFor(email, callerId);
        const token = mintInvitationToken();
        const row = await this.invitations.create({
            email,
            role: body.role,
            tokenHash: hashInvitationToken(token),
            tokenSealed: this.encryption.encrypt(token),
            expiresAt: DateTime.utc().plus(INVITATION_LIFETIME[body.role]),
            invitedBy: callerId,
        });
        return await parseAndValidate(this.toInvitation(row, DateTime.utc()), Invitation);
    }

    /** Withdraw an invitation. Its link stops working at once; the row stays, marked withdrawn. */
    async revoke(id: string): Promise<Invitation> {
        const callerId = await this.beginWrite();
        const row = await this.invitations.revoke(id, callerId);
        if (!row) {
            const existing = await this.invitations.get(id);
            if (!existing) throw httpError(404);
            throw httpError(409).withDetails({ code: ErrorCodes.INVITATION_NOT_PENDING, message: 'that invitation is no longer open' });
        }
        return await parseAndValidate(this.toInvitation(row, DateTime.utc()), Invitation);
    }

    private async beginWrite(): Promise<string> {
        this.authz.requirePlatformRole('admin');
        const { actorId } = this.authz.requireUser();
        await this.strongFactorGate.assertRecentIfAnyEnrolled(actorId);
        return actorId;
    }

    private toInvitation(row: InvitationRow, now: DateTime): Invitation {
        const state = invitationState(row, now);
        return {
            id: row.id,
            email: row.email,
            role: row.role,
            state,
            createdAt: row.createdAt,
            expiresAt: row.expiresAt,
            ...(row.inviterEmail == null ? {} : { invitedBy: row.inviterEmail }),
            ...(row.acceptedAt == null ? {} : { acceptedAt: row.acceptedAt }),
            ...(row.revokedAt == null ? {} : { revokedAt: row.revokedAt }),
            // Only an open invitation carries its link: one that is used, withdrawn or out of time
            // has nothing left to claim, and a link that cannot work should not be shown.
            ...(state === 'pending' ? { token: this.encryption.decrypt(row.tokenSealed) } : {}),
        };
    }
}
