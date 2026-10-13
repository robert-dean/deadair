import type { SdkFetch } from '../sdk-options.js';
import { parseJson, buildQueryString } from '../sdk-options.js';
import type { UserDetail, UserPage, UserQueryInput } from './types/users.types.js';
import { reviveUserDetail, reviveUserPage } from './types/users.types.js';

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
}
