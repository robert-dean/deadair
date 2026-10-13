import type {
    Invitation,
    InvitationAccept,
    InvitationAcceptStart,
    InvitationAcceptStartResponse,
    InvitationAccepted,
    InvitationCreate,
    InvitationDetails,
    InvitationList,
    InvitationToken,
} from './types/invitations.types.js';
import { reviveInvitation, reviveInvitationDetails, reviveInvitationList } from './types/invitations.types.js';
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

    /**
     * @name Read invitation
     * @description What an open invitation is for: the address, the role and the station. Changes nothing
     */
    async readInvitation(body: InvitationToken): Promise<InvitationDetails> {
        const result = await this.fetch(`/invitations/accept/details`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body, bigIntReplacer),
        });
        return reviveInvitationDetails(await parseJson<InvitationDetails>(result));
    }

    /**
     * @name Start accepting invitation
     * @description Check the password and start setting up the second step. Nothing is saved, and starting again replaces the setup
     */
    async startAcceptingInvitation(body: InvitationAcceptStart): Promise<InvitationAcceptStartResponse> {
        const result = await this.fetch(`/invitations/accept/start`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body, bigIntReplacer),
        });
        return await parseJson<InvitationAcceptStartResponse>(result);
    }

    /**
     * @name Accept invitation
     * @description Accept: make the account with its password, its second step and its role, all at once, and spend the invitation
     */
    async acceptInvitation(body: InvitationAccept): Promise<InvitationAccepted> {
        const result = await this.fetch(`/invitations/accept`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body, bigIntReplacer),
        });
        return await parseJson<InvitationAccepted>(result);
    }
}
