import type { MessagingAction, MessagingButton } from '@deadair/plugin-sdk';

/**
 * The parts of Slack's Socket Mode payloads this plugin reads, and the mapping from them to the
 * capability.
 *
 * Only what is used is typed, and every field is read defensively: a payload is whatever Slack sent.
 */

/** A `message` event, as the Events API delivers it. */
export interface SlackMessageEvent {
    type: string;
    subtype?: string;
    channel?: string;
    /** `im` for a direct message; `channel`, `group` or `mpim` for the rest. */
    channel_type?: string;
    user?: string;
    bot_id?: string;
    text?: string;
    ts?: string;
    /** The first message of the thread this one is in, when it is in one. */
    thread_ts?: string;
}

/** Which channels the station listens in, as the operator configured them. */
export interface ChannelPolicy {
    directMessages: boolean;
    channels: ReadonlySet<string>;
}

/**
 * Whether a channel id is a direct message.
 *
 * Slack's ids say what they are by their first letter, and `D` is a conversation with the app. A
 * slash command carries only the id, so this is the one test that works for all three payloads.
 */
export const isDirectChannel = (channelId: string): boolean => channelId.startsWith('D');

/** The channel's id and kind, when the operator has allowed it. */
export function allowedChannel(channelId: string | undefined, policy: ChannelPolicy) {
    if (channelId === undefined || channelId === '') return undefined;
    const chatKind = isDirectChannel(channelId) ? ('direct' as const) : ('group' as const);
    if (chatKind === 'direct' && !policy.directMessages) return undefined;
    if (chatKind === 'group' && !policy.channels.has(channelId)) return undefined;
    return { chatId: channelId, chatKind };
}

/**
 * Whether a message event is somebody talking, rather than a bot, an edit, a join, or a file with
 * nothing said.
 */
export function isPersonTalking(event: SlackMessageEvent): boolean {
    if (event.type !== 'message' || event.subtype !== undefined || event.bot_id !== undefined) return false;
    return typeof event.user === 'string' && typeof event.ts === 'string' && typeof event.text === 'string' && event.text.trim() !== '';
}

/**
 * Slack's text as the person typed it.
 *
 * Slack escapes three characters in everything it delivers, so a request for "Simon & Garfunkel"
 * arrives as `Simon &amp; Garfunkel`. Only those three: a mention (`<@U123>`) stays as Slack wrote it.
 */
export const unescapeSlack = (text: string): string => text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

/**
 * Text escaped so Slack shows it as written.
 *
 * The same three characters, the other way. With them escaped, nothing in the text can become a
 * `<!channel>` or a link, which matters because the text can carry a listener's words.
 */
export const escapeSlack = (text: string): string => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** When a Slack timestamp (`1790000000.000200`, seconds) was, as ISO-8601. */
export function tsToIso(ts: string | undefined): string {
    const seconds = Number(ts);
    return Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000).toISOString() : new Date().toISOString();
}

/** What separates a button's id from its position in `action_id`. An id never contains it. */
const ACTION_SEPARATOR = '|';

/** Slack's limits on a button. */
export const MAX_BUTTON_LABEL_LENGTH = 75;
export const MAX_BUTTON_VALUE_LENGTH = 2000;
export const MAX_ACTION_ID_LENGTH = 255;

/**
 * Buttons as a Block Kit `actions` block.
 *
 * Slack refuses a message whose buttons share an `action_id`, and "which one did you mean" is three
 * buttons with the same one. So the position rides after the id and comes off again on the way back;
 * the value travels in Slack's own `value`. A button that will not fit is left off rather than cut
 * short, since a truncated value would come back naming something else.
 */
export function actionsBlock(buttons: readonly MessagingButton[]): { block?: unknown; dropped: number } {
    const elements = buttons.flatMap((button, index) => {
        const actionId = `${button.id}${ACTION_SEPARATOR}${index}`;
        if (button.id.includes(ACTION_SEPARATOR) || actionId.length > MAX_ACTION_ID_LENGTH) return [];
        if (button.value !== undefined && (button.value === '' || button.value.length > MAX_BUTTON_VALUE_LENGTH)) return [];
        return [
            {
                type: 'button',
                action_id: actionId,
                text: { type: 'plain_text', text: clip(button.label, MAX_BUTTON_LABEL_LENGTH) },
                ...(button.value === undefined ? {} : { value: button.value }),
            },
        ];
    });
    const kept = elements.slice(0, 25);
    return { ...(kept.length === 0 ? {} : { block: { type: 'actions', elements: kept } }), dropped: buttons.length - kept.length };
}

/** An `action_id` and `value` back into the button they were made from. */
export function decodeAction(actionId: string, value: string | undefined): MessagingAction {
    const at = actionId.lastIndexOf(ACTION_SEPARATOR);
    const id = at < 0 ? actionId : actionId.slice(0, at);
    return value === undefined ? { id } : { id, value };
}

/** `text` held to `max` characters, with an ellipsis when it was cut. */
export function clip(text: string, max: number): string {
    return text.length > max ? `${text.slice(0, max - 1)}…` : text;
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
 * Slack's own error codes that mean the credentials are wrong rather than that something failed.
 * A poll refused with one of these is the operator's to fix.
 */
export const AUTH_ERRORS = new Set(['invalid_auth', 'not_authed', 'account_inactive', 'token_revoked', 'token_expired', 'not_allowed_token_type']);
