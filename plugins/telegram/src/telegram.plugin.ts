import {
    Plugin,
    PluginError,
    type MessagingAnnounceTarget,
    type MessagingPluginInstance,
    type MessagingReceiveQuery,
    type MessagingReceiveResult,
    type MessagingSendResult,
    type OutboundMessage,
    type PluginConnectionResult,
    type PluginErrorCode,
    type PluginHost,
} from '@deadair/plugin-sdk';
import { IsTelegramError, TelegramClient, type TelegramConfig } from '@maroonedsoftware/telegram';

import {
    configFlag,
    configLines,
    inlineKeyboard,
    isRetryableStatus,
    nextOffset,
    toInboundMessage,
    type ChatPolicy,
    type TelegramUpdate,
    type TelegramUser,
} from './telegram.api.js';
import { MAX_MESSAGE_LENGTH, REQUEST_TIMEOUT_MS, TELEGRAM_HOST } from './telegram.manifest.js';

export { telegramManifest } from './telegram.manifest.js';

/** What a failed Bot API call said, read off a `TelegramError`'s internal details. */
interface Refusal {
    /** The HTTP status, or absent when the call never reached Telegram. */
    status?: number;
    /** Telegram's own summary, or the transport's (with the token already redacted). */
    description: string;
}

/**
 * The station on Telegram.
 *
 * Thin, like every plugin: the host owns the loop that polls, the cursor, the commands and every word
 * the station says. What is here is `getUpdates` as `receive`, `sendMessage` as `send`, and the
 * filtering only this side can do, because chat ids are Telegram's.
 *
 * ## ServerKit's client, over the host's fetch
 *
 * The Bot API is spoken by `@maroonedsoftware/telegram`'s `TelegramClient`, handed the host's `fetch`
 * as its transport, so every call is still held to this plugin's allowlist, rate bucket and deadline.
 * The client supplies the deadline as an `AbortSignal`; the host is given whatever is left of the
 * current call as its own ceiling, which it enforces anyway. The client also redacts the bot token
 * (which the Bot API carries in every URL) from anything it throws, and this file scrubs once more
 * before an error leaves it, because a message the host reaches the operator with must never hold it.
 *
 * ## "From now", on the first poll
 *
 * With no cursor, Telegram hands over everything it still holds, up to a day of it. The capability
 * says no cursor means "from now", so the first poll asks only for the newest update, confirms past
 * it, and answers nothing: a `/now` somebody sent yesterday is not one to answer today.
 *
 * ## The host is captured before the first await
 *
 * For `plugins/weather`'s reason: a config save reinitializes the plugin under a call in flight, and
 * a long poll is in flight nearly all the time. A client is built per call over the captured host for
 * the same reason, rather than held on the instance.
 */
export class TelegramPlugin extends Plugin implements MessagingPluginInstance {
    private token = '';
    private policy: ChatPolicy = { directMessages: true, groupChats: new Set() };
    private announceChats: string[] = [];

    /** Groups somebody spoke in that are not on the list, each logged once so the operator can find its id. */
    private readonly unlistedGroups = new Set<string>();

    protected async onLoad(): Promise<void> {
        const config = await this.host.config.get();

        this.token = (await this.host.secrets.get('botToken'))?.trim() ?? '';
        this.policy = {
            directMessages: configFlag(config.directMessages, true),
            groupChats: new Set(configLines(config.groupChats)),
        };
        this.announceChats = configLines(config.announceChats);

        this.register(() => this.unlistedGroups.clear());

        this.host.logger.info('telegram ready', {
            configured: this.token !== '',
            directMessages: this.policy.directMessages,
            groups: this.policy.groupChats.size,
            announcing: this.announceChats.length,
        });
    }

    protected async onUnload(): Promise<void> {
        this.token = '';
    }

    /** Only when there is a token: without one every call is a 404 and the poller would back off forever for nothing. */
    async accepting(): Promise<boolean> {
        return this.token !== '';
    }

    async announceTargets(): Promise<MessagingAnnounceTarget[]> {
        return this.announceChats.map(chatId => ({ chatId, announcements: ['nowPlaying'] }));
    }

    async testConnection(): Promise<PluginConnectionResult> {
        const host = this.host;
        if (this.token === '') return { ok: false, message: 'No bot token set.' };

        const client = this.client(host);
        try {
            const me = (await client.getMe()) as TelegramUser;

            // A webhook set on the bot takes its updates, and Telegram refuses a poll while one is.
            const hook = (await client.getWebhookInfo()) as { url?: string };
            if (typeof hook.url === 'string' && hook.url !== '') {
                return { ok: false, message: 'This bot has a webhook set, which stops the station hearing it. Remove it with deleteWebhook.' };
            }

            const name = typeof me.username === 'string' ? `@${me.username}` : 'the bot';
            return { ok: true, message: `Connected as ${name}.` };
        } catch (error) {
            return { ok: false, message: this.explain(this.refusal(error)) };
        }
    }

    async receive(query: MessagingReceiveQuery): Promise<MessagingReceiveResult> {
        const host = this.host;
        if (this.token === '') throw new PluginError('No bot token set.').withCode('config');
        const client = this.client(host);

        try {
            if (query.cursor === undefined) {
                // Only the newest, and without waiting: this is finding out where "now" is.
                const newest = (await client.getUpdates({ offset: -1, timeout: 0 })) as TelegramUpdate[];
                const cursor = nextOffset(newest);
                if (cursor !== undefined) return { messages: [], cursor };
                // Nothing held at all, so anything that arrives from here on is new.
            }

            const updates = (await client.getUpdates({
                ...(query.cursor === undefined ? {} : { offset: Number(query.cursor) }),
                timeout: Math.max(0, Math.floor(query.waitMs / 1000)),
                allowed_updates: ['message', 'callback_query'],
            })) as TelegramUpdate[];

            const messages = [];
            for (const update of updates) {
                const message = toInboundMessage(update, this.policy);
                if (message !== undefined) messages.push(message);
                else this.noteUnlistedGroup(host, update);

                // Every press is acknowledged, allowed or not, or the button spins on the person's screen.
                // Nothing rides on it, so a failure is only logged.
                if (update.callback_query !== undefined) {
                    await client
                        .answerCallbackQuery({ callback_query_id: update.callback_query.id })
                        .catch((error: unknown) =>
                            host.logger.debug('telegram: could not acknowledge a button press', { reason: this.refusal(error).description }),
                        );
                }
            }

            const cursor = nextOffset(updates);
            return { messages, ...(cursor === undefined ? {} : { cursor }) };
        } catch (error) {
            const refusal = this.refusal(error);
            throw new PluginError(this.explain(refusal)).withCode(codeFor(refusal));
        }
    }

    async send(message: OutboundMessage): Promise<MessagingSendResult> {
        const host = this.host;
        if (this.token === '') return { delivered: false, reason: 'no bot token set', retryable: false };

        const text = message.text.length > MAX_MESSAGE_LENGTH ? `${message.text.slice(0, MAX_MESSAGE_LENGTH - 1)}…` : message.text;
        const buttons = message.buttons === undefined || message.buttons.length === 0 ? undefined : inlineKeyboard(message.buttons);
        if (buttons !== undefined && buttons.dropped > 0)
            host.logger.warn('telegram: left off buttons too long for Telegram', { dropped: buttons.dropped });
        try {
            // No `parse_mode`, so Telegram reads the text as plain text and nothing in it needs escaping.
            await this.client(host).sendMessage({
                chat_id: message.chatId,
                text,
                link_preview_options: { is_disabled: true },
                ...(buttons === undefined || buttons.keyboard.length === 0 ? {} : { reply_markup: { inline_keyboard: buttons.keyboard } }),
                ...(message.replyToId === undefined
                    ? {}
                    : { reply_parameters: { message_id: Number(message.replyToId), allow_sending_without_reply: true } }),
            });
            return { delivered: true };
        } catch (error) {
            const refusal = this.refusal(error);
            // A call that never reached Telegram is worth another go, as the SDK says a throw would be.
            return { delivered: false, reason: this.explain(refusal), retryable: refusal.status === undefined || isRetryableStatus(refusal.status) };
        }
    }

    /** A Bot API client for one call, speaking through the host's fetch. */
    private client(host: PluginHost): TelegramClient {
        const config: TelegramConfig = {
            botToken: this.token,
            apiBaseUrl: `https://${TELEGRAM_HOST}`,
            requestTimeoutMs: REQUEST_TIMEOUT_MS,
            fetch: (url, init) =>
                host.fetch(url, {
                    method: init.method,
                    headers: init.headers,
                    body: init.body,
                    signal: init.signal,
                    // The client's signal carries the real deadline; this is only the host's ceiling.
                    timeoutMs: host.remainingMs(),
                }),
        };
        return new TelegramClient(config, {
            error: (message: unknown, ...rest: unknown[]) => host.logger.error(String(message), meta(rest)),
            warn: (message: unknown, ...rest: unknown[]) => host.logger.warn(String(message), meta(rest)),
            info: (message: unknown, ...rest: unknown[]) => host.logger.info(String(message), meta(rest)),
            debug: (message: unknown, ...rest: unknown[]) => host.logger.debug(String(message), meta(rest)),
            trace: (message: unknown, ...rest: unknown[]) => host.logger.debug(String(message), meta(rest)),
        });
    }

    /** What went wrong, from a `TelegramError` or anything else, with the token scrubbed. */
    private refusal(error: unknown): Refusal {
        if (IsTelegramError(error)) {
            const details = (error.internalDetails ?? {}) as { status?: unknown; description?: unknown; reason?: unknown };
            const described =
                typeof details.description === 'string' ? details.description : typeof details.reason === 'string' ? details.reason : error.message;
            return { ...(typeof details.status === 'number' ? { status: details.status } : {}), description: this.scrub(described) };
        }
        return { description: this.scrub(error instanceof Error ? error.message : String(error)) };
    }

    /** A refusal in words an operator can act on. */
    private explain(refusal: Refusal): string {
        if (refusal.status === 401 || refusal.status === 404) return `Telegram did not accept the bot token (${refusal.description}).`;
        if (refusal.status === undefined) return `Could not reach Telegram: ${refusal.description}`;
        return `Telegram refused: ${refusal.description}`;
    }

    /** `text` with the token replaced, for the last line of defence before anything leaves this file. */
    private scrub(text: string): string {
        return this.token === '' ? text : text.split(this.token).join('<token>');
    }

    /** Log a group's id the first time somebody there speaks, so the operator can add it to the list. */
    private noteUnlistedGroup(host: PluginHost, update: TelegramUpdate): void {
        const message = update.message ?? update.callback_query?.message;
        if (message === undefined || (message.chat.type !== 'group' && message.chat.type !== 'supergroup')) return;
        const chatId = String(message.chat.id);
        if (this.policy.groupChats.has(chatId) || this.unlistedGroups.has(chatId)) return;

        this.unlistedGroups.add(chatId);
        host.logger.info('telegram: a group that is not on the list spoke to the bot; add its id to answer there', {
            chatId,
            ...(typeof message.chat.title === 'string' ? { title: message.chat.title } : {}),
        });
    }
}

/** The host's vocabulary for a refused poll: the token, a webhook in the way, or anything else upstream. */
function codeFor(refusal: Refusal): PluginErrorCode {
    if (refusal.status === 401 || refusal.status === 404) return 'auth';
    if (refusal.status === 409) return 'config';
    if (refusal.status === 429) return 'rate_limited';
    return refusal.status === undefined ? 'unavailable' : 'upstream';
}

/** A logger's trailing arguments as the one metadata object the plugin logger takes. */
function meta(rest: unknown[]): Record<string, unknown> | undefined {
    const first = rest[0];
    return first !== null && typeof first === 'object' && !Array.isArray(first) ? (first as Record<string, unknown>) : undefined;
}
