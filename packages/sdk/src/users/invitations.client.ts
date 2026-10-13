import type { Invitation, InvitationCreate, InvitationList } from './types/invitations.types.js';
import { reviveInvitation, reviveInvitationList } from './types/invitations.types.js';
import type { SdkFetch } from '../sdk-options.js';
import { bigIntReplacer, parseJson } from '../sdk-options.js';

/**
 * generated from [invitations.ck](../../../../apps/api/data/contracts/users/invitations.ck)
 */
export class UsersInvitationsClient {
    constructor(private fetch: SdkFetch) {}

    /**
     * @name List invitations
     * @description Every invitation, newest first, with the link of each one still open
     */
    async listInvitations(): Promise<InvitationList> {
        const result = await this.fetch(`/invitations`, { method: 'GET' });
        return reviveInvitationList(await parseJson<InvitationList>(result));
    }

    /**
     * @name Create invitation
     * @description Invite somebody into a role. An open invitation to the same address is withdrawn first, so this is also how one is sent again. Refused for an address that already has an account
     */
    async createInvitation(body: InvitationCreate): Promise<Invitation> {
        const result = await this.fetch(`/invitations`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body, bigIntReplacer),
        });
        return reviveInvitation(await parseJson<Invitation>(result));
    }

    /**
     * @name Revoke invitation
     * @description Withdraw an invitation. Its link stops working at once. Nothing is deleted: it stays in the list as withdrawn
     */
    async revokeInvitation(id: string): Promise<Invitation> {
        const result = await this.fetch(`/invitations/${encodeURIComponent(id)}`, { method: 'DELETE' });
        return reviveInvitation(await parseJson<Invitation>(result));
    }
}
