import { Injectable } from 'injectkit';
import { Logger } from '@maroonedsoftware/logger';
import type { MessagingReceiveQuery, MessagingReceiveResult, MessagingSendResult, OutboundMessage } from '@deadair/plugin-sdk';
import { asMessagingPlugin, type MessagingPlugin } from '#modules/plugins/plugin.capabilities.js';
import { byPluginId, pluginsWith } from '#modules/plugins/plugin.selection.js';
import { PluginInvoker } from '#modules/plugins/plugin.invoker.js';
import { PluginRegistry } from '#modules/plugins/plugin.registry.js';
import { errorText } from '#modules/shared/error.text.js';

/**
 * How long past a long poll's own wait the call into the plugin may run before it is abandoned.
 *
 * The plugin holds the platform's connection open for up to `waitMs` and then has to read and map
 * the answer, so the invoker's deadline sits comfortably above the wait rather than at it: a poll
 * cut off at exactly its own length is a timeout on every quiet stretch, and three of those
 * quarantine the plugin.
 */
export const MESSAGING_RECEIVE_MARGIN_MS = 15_000;

/** How long one `send` or `accepting` may take. A reply somebody is waiting for, so not long. */
const SEND_TIMEOUT_MS = 15_000;

/**
 * Talking to the chat platforms the station is connected to.
 *
 * Every active `messaging` plugin is a place people reach the station, so there is no choosing
 * between them, for the reason scrobble gives: two platforms are two audiences rather than two
 * answers to one question.
 *
 * A singleton, because it holds nothing but the plugin registry and invoker, which are singletons
 * themselves, and because the poller that drives it runs off the request path.
 */
@Injectable()
export class MessagingService {
    constructor(
        private readonly pluginRegistry: PluginRegistry,
        private readonly pluginInvoker: PluginInvoker,
        private readonly logger: Logger,
    ) {}

    /** Every messaging plugin installed and running, in a stable order. */
    platforms(): MessagingPlugin[] {
        return pluginsWith(this.pluginRegistry.list(), asMessagingPlugin).sort(byPluginId);
    }

    /** One platform by plugin id, if it is installed and running. */
    platform(pluginId: string): MessagingPlugin | undefined {
        const record = this.pluginRegistry.get(pluginId);
        return record === undefined ? undefined : asMessagingPlugin(record);
    }

    /**
     * Whether this platform wants to be listened to and written to right now.
     *
     * Absent means yes, per the SDK. A plugin that throws is treated as NOT accepting, which is
     * scrobble's rule and for its reason: the alternative is talking in a chat whose plugin could not
     * say whether it was meant to.
     */
    async accepting(platform: MessagingPlugin): Promise<boolean> {
        if (!platform.declarable) return true;

        try {
            return await this.pluginInvoker.invoke(platform.record.id, 'messaging.accepting', async () => platform.instance.accepting!(), {
                timeoutMs: SEND_TIMEOUT_MS,
            });
        } catch (error) {
            this.logger.info(`messaging: a platform could not say whether it is accepting (${platform.record.id}: ${errorText(error)})`);
            return false;
        }
    }

    /**
     * Ask one platform what has arrived.
     *
     * Throws what the invoker throws. The poller owns the backoff, and a failed poll is recorded
     * against the plugin's breaker like any other failed call, so a platform that stays down is
     * quarantined and stops being polled until its probe says it is back.
     */
    async receive(platform: MessagingPlugin, query: MessagingReceiveQuery): Promise<MessagingReceiveResult> {
        return this.pluginInvoker.invoke(platform.record.id, 'messaging.receive', async () => platform.instance.receive(query), {
            timeoutMs: query.waitMs + MESSAGING_RECEIVE_MARGIN_MS,
        });
    }

    /**
     * Send one message through one platform.
     *
     * Never throws. A plugin that could not reach its platform at all threw, which the SDK says is
     * retryable, so that is how it is reported; everything else is the plugin's own classification.
     */
    async send(pluginId: string, message: OutboundMessage): Promise<MessagingSendResult> {
        const platform = this.platform(pluginId);
        if (platform === undefined) return { delivered: false, reason: 'the platform is not running', retryable: true };

        try {
            return await this.pluginInvoker.invoke(pluginId, 'messaging.send', async () => platform.instance.send(message), {
                timeoutMs: SEND_TIMEOUT_MS,
            });
        } catch (error) {
            return { delivered: false, reason: errorText(error), retryable: true };
        }
    }
}
