import { Injectable } from 'injectkit';
import { httpError } from '@maroonedsoftware/errors';
import { DateTime } from 'luxon';
import { AuthorizationContext } from '#modules/permissions/authorization.context.js';
import { LINK_CODE_TTL_MS, hashLinkCode, newLinkCode } from './messaging.link.code.js';
import { MessagingRepository } from './messaging.repository.js';
import type { MessagingLinkCode, MessagingLinkList } from './types/messaging.types.js';

/**
 * The console's half of linking a chat account: minting the code, and listing and removing links.
 * The chat half, `/link CODE`, is `MessagingOperator`'s.
 *
 * Every method starts with `requireAuthentication`, which refuses a request made with an API key,
 * for `ApiKeysService`'s reason: a key must not be able to hand a chat account the powers of the
 * account that owns it.
 */
@Injectable()
export class MessagingLinksService {
    constructor(
        private readonly authz: AuthorizationContext,
        private readonly repository: MessagingRepository,
    ) {}

    async list(): Promise<MessagingLinkList> {
        const { actorId } = this.authz.requireAuthentication();
        return { links: await this.repository.links(actorId) };
    }

    /** A new code, replacing any earlier one. The code is in this answer and nowhere else. */
    async createCode(): Promise<MessagingLinkCode> {
        const { actorId } = this.authz.requireAuthentication();
        const code = newLinkCode();
        const expiresAt = DateTime.now().plus({ milliseconds: LINK_CODE_TTL_MS });
        await this.repository.saveLinkCode(actorId, hashLinkCode(code), expiresAt);
        return { code, expiresAt };
    }

    /** Remove one of the caller's own links. Somebody else's answers 404, the same as one that never existed. */
    async remove(pluginId: string, platformUserId: string): Promise<void> {
        const { actorId } = this.authz.requireAuthentication();
        if (!(await this.repository.unlink(pluginId, platformUserId, actorId))) {
            throw httpError(404).withDetails({ message: 'no such link' });
        }
    }
}
