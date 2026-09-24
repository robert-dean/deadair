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
    type PluginHost,
} from '@deadair/plugin-sdk';

import {
    configFlag,
    configLines,
    isRetryableStatus,
    nextOffset,
    toInboundMessage,
    type ChatPolicy,
    type TelegramEnvelope,
    type TelegramMessage,
    type TelegramUpdate,
    type TelegramUser,
} from './telegram.api.js';
import { MAX_MESSAGE_LENGTH, REQUEST_TIMEOUT_MS, TELEGRAM_HOST } from './telegram.manifest.js';

export { telegramManifest } from './telegram.manifest.js';

/** What one call to the Bot API came back with: the envelope, and the HTTP status it arrived under. */
interface Answer<T> {
    status: number;
    envelope: TelegramEnvelope<T>;
}

/**
 * The station on Telegram.
 *
 * Thin, like every plugin: the host owns the loop that polls, the cursor, the commands and every word
 * the station says. What is here is the Bot API: `getUpdates` as `receive`, `sendMessage` as `send`,
 * and the filtering only this side can do, because chat ids are Telegram's.
 *
 * ## The token is in every URL, so no URL leaves this file
 *
 * The Bot API authenticates by putting the token in the path, and the host's own errors about a
 * response body quote the URL it came from. Every call is wrapped so that anything thrown has the
 * token replaced before it reaches the host's logs or an operator's screen.
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
 * a long poll is in flight nearly all the time.
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

        try {
            const me = await this.call<TelegramUser>(host, 'getMe', {}, REQUEST_TIMEOUT_MS);
            if (!me.envelope.ok || me.envelope.result === undefined) return { ok: false, message: this.refusal(me) };

            // A webhook set on the bot takes its updates, and Telegram refuses a poll while one is.
            const hook = await this.call<{ url?: string }>(host, 'getWebhookInfo', {}, REQUEST_TIMEOUT_MS);
            if (hook.envelope.ok && typeof hook.envelope.result?.url === 'string' && hook.envelope.result.url !== '') {
                return { ok: false, message: 'This bot has a webhook set, which stops the station hearing it. Remove it with deleteWebhook.' };
            }

            const name = typeof me.envelope.result.username === 'string' ? `@${me.envelope.result.username}` : 'the bot';
            return { ok: true, message: `Connected as ${name}.` };
        } catch (error) {
            return { ok: false, message: error instanceof Error ? error.message : String(error) };
        }
    }

    async receive(query: MessagingReceiveQuery): Promise<MessagingReceiveResult> {
        const host = this.host;
        if (this.token === '') throw new PluginError('No bot token set.').withCode('config');

        if (query.cursor === undefined) {
            // Only the newest, and without waiting: this is finding out where "now" is.
            const newest = await this.updates(host, { offset: -1, timeout: 0 }, REQUEST_TIMEOUT_MS);
            const cursor = nextOffset(newest);
            if (cursor !== undefined) return { messages: [], cursor };
            // Nothing held at all, so anything that arrives from here on is new.
        }

        const waitSeconds = Math.max(0, Math.floor(query.waitMs / 1000));
        const updates = await this.updates(
            host,
            { ...(query.cursor === undefined ? {} : { offset: Number(query.cursor) }), timeout: waitSeconds },
            query.waitMs + REQUEST_TIMEOUT_MS,
        );

        const messages = [];
        for (const update of updates) {
            const message = toInboundMessage(update, this.policy);
            if (message !== undefined) messages.push(message);
            else this.noteUnlistedGroup(host, update.message);
        }

        const cursor = nextOffset(updates);
        return { messages, ...(cursor === undefined ? {} : { cursor }) };
    }

    async send(message: OutboundMessage): Promise<MessagingSendResult> {
        const host = this.host;
        if (this.token === '') return { delivered: false, reason: 'no bot token set', retryable: false };

        const text = message.text.length > MAX_MESSAGE_LENGTH ? `${message.text.slice(0, MAX_MESSAGE_LENGTH - 1)}…` : message.text;
        // No `parse_mode`, so Telegram reads the text as plain text and nothing in it needs escaping.
        const body = {
            chat_id: message.chatId,
            text,
            link_preview_options: { is_disabled: true },
            ...(message.replyToId === undefined
                ? {}
                : { reply_parameters: { message_id: Number(message.replyToId), allow_sending_without_reply: true } }),
        };

        const answer = await this.call<TelegramMessage>(host, 'sendMessage', body, REQUEST_TIMEOUT_MS);
        if (answer.envelope.ok) return { delivered: true };
        return { delivered: false, reason: this.refusal(answer), retryable: isRetryableStatus(answer.status) };
    }

    /** `getUpdates`, for text messages only, answered as the list or thrown as the refusal. */
    private async updates(host: PluginHost, params: { offset?: number; timeout: number }, timeoutMs: number): Promise<TelegramUpdate[]> {
        const answer = await this.call<TelegramUpdate[]>(host, 'getUpdates', { ...params, allowed_updates: ['message'] }, timeoutMs);
        if (!answer.envelope.ok) {
            const code = answer.status === 401 || answer.status === 404 ? 'auth' : answer.status === 409 ? 'config' : 'upstream';
            throw new PluginError(this.refusal(answer)).withCode(code);
        }
        return Array.isArray(answer.envelope.result) ? answer.envelope.result : [];
    }

    /**
     * One Bot API call. Throws only when Telegram could not be reached or did not answer in JSON, and
     * never with the token in the message.
     */
    private async call<T>(host: PluginHost, method: string, body: object, timeoutMs: number): Promise<Answer<T>> {
        const token = this.token;
        try {
            const response = await host.fetch(`https://${TELEGRAM_HOST}/bot${token}/${method}`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify(body),
                timeoutMs,
            });
            const envelope = (await response.json()) as TelegramEnvelope<T>;
            return { status: response.status, envelope };
        } catch (error) {
            throw scrubbed(error, token);
        }
    }

    /** What Telegram said, for a log line or the settings page. Its own `description` is already a summary. */
    private refusal(answer: Answer<unknown>): string {
        const description = typeof answer.envelope.description === 'string' ? answer.envelope.description : `HTTP ${answer.status}`;
        if (answer.status === 401 || answer.status === 404) return `Telegram did not accept the bot token (${description}).`;
        return `Telegram refused: ${description}`;
    }

    /** Log a group's id the first time somebody there speaks, so the operator can add it to the list. */
    private noteUnlistedGroup(host: PluginHost, message: TelegramMessage | undefined): void {
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

/** `error`, with every occurrence of the token replaced, and its code kept where it had one. */
export function scrubbed(error: unknown, token: string): PluginError {
    const text = error instanceof Error ? error.message : String(error);
    const message = token === '' ? text : text.split(token).join('<token>');
    const code = error instanceof PluginError ? error.code : 'upstream';
    return new PluginError(message).withCode(code);
}
