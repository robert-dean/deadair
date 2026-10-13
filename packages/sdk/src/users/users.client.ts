import type { SdkFetch } from '../sdk-options.js';
import { bigIntReplacer, parseJson, buildQueryString } from '../sdk-options.js';
import type { UserDetail, UserPage, UserQueryInput, UserRoleChange, UserSummary } from './types/users.types.js';
import { reviveUserDetail, reviveUserPage, reviveUserSummary } from './types/users.types.js';

export class UsersClient {
    constructor(private fetch: SdkFetch) {}

    /**
     * @name List users
     * @description The station's people, one page at a time, ordered by when their account was made
     */
    async listUsers(query?: UserQueryInput): Promise<UserPage> {
        const qs = buildQueryString(query);
        const result = await this.fetch(`/users${qs}`, {
            method: 'GET',
        });
        return reviveUserPage(await parseJson<UserPage>(result));
    }

    /**
     * @name Get user
     * @description One person, with every way they sign in, where they are signed in and their recent sign-ins
     */
    async getUser(id: string): Promise<UserDetail> {
        const result = await this.fetch(`/users/${encodeURIComponent(id)}`, { method: 'GET' });
        return reviveUserDetail(await parseJson<UserDetail>(result));
    }

    /**
     * @name Change user role
     * @description Give a person a different role. They hold exactly one, so the role they had is taken away. Refused for your own account, and for the last admin
     */
    async changeUserRole(id: string, body: UserRoleChange): Promise<UserSummary> {
        const result = await this.fetch(`/users/${encodeURIComponent(id)}/role`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body, bigIntReplacer),
        });
        return reviveUserSummary(await parseJson<UserSummary>(result));
    }

    /**
     * @name Deactivate user
     * @description Switch a person off. They are signed out everywhere and cannot sign in, and their API keys, connected apps and chat links stop working, until they are switched back on. Nothing is deleted. Refused for your own account, and for the last admin
     */
    async deactivateUser(id: string): Promise<UserSummary> {
        const result = await this.fetch(`/users/${encodeURIComponent(id)}/deactivate`, { method: 'POST' });
        return reviveUserSummary(await parseJson<UserSummary>(result));
    }

    /**
     * @name Reactivate user
     * @description Switch a person back on. They sign in as they did before, and their API keys, connected apps and chat links work again
     */
    async reactivateUser(id: string): Promise<UserSummary> {
        const result = await this.fetch(`/users/${encodeURIComponent(id)}/reactivate`, { method: 'POST' });
        return reviveUserSummary(await parseJson<UserSummary>(result));
    }

    /**
     * @name Sign out user
     * @description Sign a person out everywhere. They can sign straight back in
     */
    async signOutUser(id: string): Promise<void> {
        await this.fetch(`/users/${encodeURIComponent(id)}/sign-out`, { method: 'POST' });
    }

    /**
     * @name Reset user MFA
     * @description Remove a person's authenticator apps and passkeys and sign them out everywhere, for when they have lost the device. They sign in with their password and set a new one up
     */
    async resetUserMFA(id: string): Promise<void> {
        await this.fetch(`/users/${encodeURIComponent(id)}/mfa/reset`, { method: 'POST' });
    }
}
