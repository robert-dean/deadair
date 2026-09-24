import type { InboundMessage, MessagingAction, MessagingButton } from '@deadair/plugin-sdk';

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

/** A button pressed on one of the bot's messages. */
export interface TelegramCallbackQuery {
    id: string;
    from: TelegramUser;
    /** The message the button was on. Absent for a message too old for Telegram to say. */
    message?: TelegramMessage;
    data?: string;
}

export interface TelegramUpdate {
    update_id: number;
    message?: TelegramMessage;
    callback_query?: TelegramCallbackQuery;
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
    if (update.callback_query !== undefined) return fromCallbackQuery(update.callback_query, policy);

    const message = update.message;
    if (message === undefined || typeof message.text !== 'string' || message.text.trim() === '') return undefined;

    const from = message.from;
    if (from === undefined || from.is_bot === true) return undefined;

    const chat = allowedChat(message.chat, policy);
    if (chat === undefined) return undefined;

    return {
        id: String(message.message_id),
        chatId: chat.chatId,
        chatKind: chat.chatKind,
        sender: { id: String(from.id), displayName: displayName(from) },
        text: message.text,
        sentAt: new Date(message.date * 1000).toISOString(),
    };
}

/** A button press, as the message it was on with the button's action attached. */
function fromCallbackQuery(query: TelegramCallbackQuery, policy: ChatPolicy): InboundMessage | undefined {
    if (query.from.is_bot === true || query.message === undefined || typeof query.data !== 'string') return undefined;

    const chat = allowedChat(query.message.chat, policy);
    if (chat === undefined) return undefined;

    return {
        id: String(query.message.message_id),
        chatId: chat.chatId,
        chatKind: chat.chatKind,
        sender: { id: String(query.from.id), displayName: displayName(query.from) },
        text: '',
        action: decodeAction(query.data),
        sentAt: new Date().toISOString(),
    };
}

/** The chat's id and kind, when the operator has allowed it. */
function allowedChat(chat: TelegramChat, policy: ChatPolicy): { chatId: string; chatKind: 'direct' | 'group' } | undefined {
    const chatId = String(chat.id);
    const chatKind = chat.type === 'private' ? 'direct' : chat.type === 'group' || chat.type === 'supergroup' ? 'group' : undefined;
    if (chatKind === undefined) return undefined;
    if (chatKind === 'direct' && !policy.directMessages) return undefined;
    if (chatKind === 'group' && !policy.groupChats.has(chatId)) return undefined;
    return { chatId, chatKind };
}

/** Telegram's limit on `callback_data`, in bytes. */
export const MAX_CALLBACK_DATA_BYTES = 64;

/** What separates a button's id from its value in `callback_data`. An id never contains it. */
const ACTION_SEPARATOR = '|';

/** A button's id and value as one `callback_data` string, or nothing when they do not fit. */
export function encodeAction(button: MessagingButton): string | undefined {
    if (button.id.includes(ACTION_SEPARATOR)) return undefined;
    const data = button.value === undefined ? button.id : `${button.id}${ACTION_SEPARATOR}${button.value}`;
    return Buffer.byteLength(data, 'utf8') <= MAX_CALLBACK_DATA_BYTES ? data : undefined;
}

/** `callback_data` back into the id and value it was made from. */
export function decodeAction(data: string): MessagingAction {
    const at = data.indexOf(ACTION_SEPARATOR);
    return at < 0 ? { id: data } : { id: data.slice(0, at), value: data.slice(at + 1) };
}

/**
 * Buttons as an inline keyboard, up to five to a row as ServerKit's own Telegram adapter lays them
 * out. A button whose id and value do not fit in `callback_data` is left off rather than cut short,
 * since a truncated value would come back naming something else.
 */
export function inlineKeyboard(buttons: readonly MessagingButton[]): {
    keyboard: Array<Array<{ text: string; callback_data: string }>>;
    dropped: number;
} {
    const fitting = buttons.flatMap(button => {
        const data = encodeAction(button);
        return data === undefined ? [] : [{ text: button.label, callback_data: data }];
    });
    const keyboard = [];
    for (let index = 0; index < fitting.length; index += 5) keyboard.push(fitting.slice(index, index + 5));
    return { keyboard, dropped: buttons.length - fitting.length };
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
