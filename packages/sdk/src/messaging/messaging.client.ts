import type { SdkFetch } from '../sdk-options.js';
import { parseJson } from '../sdk-options.js';
import type { MessagingLinkCode, MessagingLinkList } from './types/messaging.types.js';
import { reviveMessagingLinkCode, reviveMessagingLinkList } from './types/messaging.types.js';

export class MessagingClient {
    constructor(private fetch: SdkFetch) {}

    /**
     * @name List messaging links
     * @description The chat accounts linked to the signed-in account
     */
    async listMessagingLinks(): Promise<MessagingLinkList> {
        const result = await this.fetch(`/messaging/links`, { method: 'GET' });
        return reviveMessagingLinkList(await parseJson<MessagingLinkList>(result));
    }

    /**
     * @name Create messaging link code
     * @description A new one-time code for linking a chat account. It replaces any earlier code and stops working after ten minutes
     */
    async createMessagingLinkCode(): Promise<MessagingLinkCode> {
        const result = await this.fetch(`/messaging/links/code`, { method: 'POST' });
        return reviveMessagingLinkCode(await parseJson<MessagingLinkCode>(result));
    }

    /**
     * @name Remove messaging link
     * @description Unlink a chat account. Its operator commands are refused from the next one on
     */
    async removeMessagingLink(pluginId: string, platformUserId: string): Promise<void> {
        await this.fetch(`/messaging/links/${encodeURIComponent(pluginId)}/${encodeURIComponent(platformUserId)}`, { method: 'DELETE' });
    }
}
