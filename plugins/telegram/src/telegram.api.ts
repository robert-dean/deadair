import type { InboundMessage } from '@deadair/plugin-sdk';

/**
 * The parts of the Telegram Bot API this plugin reads, and the mapping from them to the capability.
 *
 * Only what is used is typed. Telegram adds fields freely, and every one of these is read
 * defensively because a JSON body is whatever the other end sent.
 */

export interface TelegramUser {
    id: number;
    is_bot?: boolean;
    first_name?: string;
    last_name?: string;
    username?: string;
}

export interface TelegramChat {
    id: number;
    type: 'private' | 'group' | 'supergroup' | 'channel' | string;
    title?: string;
}

export interface TelegramMessage {
    message_id: number;
    from?: TelegramUser;
    chat: TelegramChat;
    date: number;
    text?: string;
}

export interface TelegramUpdate {
    update_id: number;
    message?: TelegramMessage;
}

/**
 * The cursor after a batch of updates: one past the highest `update_id` seen.
 *
 * Past EVERY update, including the ones filtered out, because Telegram only forgets an update when
 * a later `offset` confirms it, and a skipped sticker left unconfirmed would come back on every poll.
 */
export function nextOffset(updates: readonly TelegramUpdate[]): string | undefined {
    let highest: number | undefined;
    for (const update of updates) {
        if (typeof update.update_id === 'number' && (highest === undefined || update.update_id > highest)) highest = update.update_id;
    }
    return highest === undefined ? undefined : String(highest + 1);
}

/** What to call somebody: their name as Telegram shows it, or their handle, or nothing better than "someone". */
export function displayName(user: TelegramUser): string {
    const name = [user.first_name, user.last_name]
        .filter((part): part is string => typeof part === 'string' && part.trim() !== '')
        .join(' ')
        .trim();
    if (name !== '') return name;
    if (typeof user.username === 'string' && user.username.trim() !== '') return `@${user.username.trim()}`;
    return 'someone';
}

/** Which chats the station listens in, as the operator configured them. */
export interface ChatPolicy {
    directMessages: boolean;
    groupChats: ReadonlySet<string>;
}

/**
 * One update as a message the station should act on, or nothing.
 *
 * Nothing for an update that is not a text message (a sticker, a join, an edit), for anything a bot
 * wrote (this one included), for a channel post, and for a chat the operator has not allowed. The
 * cursor still moves past all of them: see {@link nextOffset}.
 */
export function toInboundMessage(update: TelegramUpdate, policy: ChatPolicy): InboundMessage | undefined {
    const message = update.message;
    if (message === undefined || typeof message.text !== 'string' || message.text.trim() === '') return undefined;

    const from = message.from;
    if (from === undefined || from.is_bot === true) return undefined;

    const chatId = String(message.chat.id);
    const chatKind =
        message.chat.type === 'private' ? 'direct' : message.chat.type === 'group' || message.chat.type === 'supergroup' ? 'group' : undefined;
    if (chatKind === undefined) return undefined;
    if (chatKind === 'direct' && !policy.directMessages) return undefined;
    if (chatKind === 'group' && !policy.groupChats.has(chatId)) return undefined;

    return {
        id: String(message.message_id),
        chatId,
        chatKind,
        sender: { id: String(from.id), displayName: displayName(from) },
        text: message.text,
        sentAt: new Date(message.date * 1000).toISOString(),
    };
}

/** A multi-line config field as its non-empty lines. Commas separate too, since that is what people paste. */
export function configLines(value: unknown): string[] {
    if (typeof value !== 'string') return [];
    return value
        .split(/[\n,]/)
        .map(line => line.trim())
        .filter(line => line !== '');
}

/** A boolean config field, where the stored value may be a real boolean or its text. Absent takes the default. */
export function configFlag(value: unknown, fallback: boolean): boolean {
    if (value === true || value === 'true') return true;
    if (value === false || value === 'false') return false;
    return fallback;
}

/**
 * Whether Telegram refusing a send is worth trying again.
 *
 * A rate limit and anything on Telegram's side, yes. A 400 (a chat that does not exist, a message it
 * will not take) and a 403 (the bot was blocked or removed) will be refused the same way next time.
 */
export const isRetryableStatus = (status: number): boolean => status === 429 || status >= 500;
