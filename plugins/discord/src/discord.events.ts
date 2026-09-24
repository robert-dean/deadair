import type { InboundMessage, MessagingAction, MessagingButton, MessagingCommand } from '@deadair/plugin-sdk';

/**
 * The parts of the Discord Gateway and REST API this plugin reads, and the mapping from them to the
 * capability.
 *
 * Only what is used is typed, and every field is read defensively: a dispatch is whatever Discord
 * sent, and Discord adds fields freely.
 */

export interface DiscordUser {
    id: string;
    username?: string;
    global_name?: string | null;
    bot?: boolean;
}

/** A person as a server knows them: their nickname there, when they have one. */
export interface DiscordMember {
    user?: DiscordUser;
    nick?: string | null;
}

/** A `MESSAGE_CREATE` dispatch. */
export interface DiscordMessage {
    id: string;
    channel_id: string;
    /** Absent in a direct message. */
    guild_id?: string;
    author?: DiscordUser;
    member?: DiscordMember;
    content?: string;
    timestamp?: string;
    /** A message the bot wrote through a webhook, which is never somebody talking to it. */
    webhook_id?: string;
}

/** An `INTERACTION_CREATE` dispatch: a slash command, or a button pressed. */
export interface DiscordInteraction {
    id: string;
    token: string;
    type: number;
    channel_id?: string;
    guild_id?: string;
    /** Who, in a server. */
    member?: DiscordMember;
    /** Who, in a direct message. */
    user?: DiscordUser;
    data?: {
        name?: string;
        options?: Array<{ name?: string; type?: number; value?: unknown }>;
        custom_id?: string;
    };
}

/** Discord's interaction types that this plugin answers. */
export const INTERACTION_COMMAND = 2;
export const INTERACTION_COMPONENT = 3;

/** Which channels the station listens in, as the operator configured them. */
export interface ChannelPolicy {
    directMessages: boolean;
    channels: ReadonlySet<string>;
}

/** What to call somebody: their nickname in the server, their display name, their username, or "someone". */
export function displayName(user: DiscordUser | undefined, member?: DiscordMember): string {
    for (const name of [member?.nick, user?.global_name, user?.username]) {
        if (typeof name === 'string' && name.trim() !== '') return name.trim();
    }
    return 'someone';
}

/** The channel's id and kind, when the operator has allowed it. A message with no server is a direct one. */
export function allowedChannel(channelId: string | undefined, guildId: string | undefined, policy: ChannelPolicy) {
    if (channelId === undefined) return undefined;
    const chatKind = guildId === undefined ? ('direct' as const) : ('group' as const);
    if (chatKind === 'direct' && !policy.directMessages) return undefined;
    if (chatKind === 'group' && !policy.channels.has(channelId)) return undefined;
    return { chatId: channelId, chatKind };
}

/**
 * One `MESSAGE_CREATE` as a message the station should act on, or nothing.
 *
 * Nothing for a bot (this one included), a webhook, an empty message (an attachment on its own, or
 * a server without the Message Content intent granted, where every message arrives empty), and a
 * channel the operator has not allowed.
 */
export function messageToInbound(message: DiscordMessage, policy: ChannelPolicy): InboundMessage | undefined {
    if (message.author === undefined || message.author.bot === true || message.webhook_id !== undefined) return undefined;
    if (typeof message.content !== 'string' || message.content.trim() === '') return undefined;

    const chat = allowedChannel(message.channel_id, message.guild_id, policy);
    if (chat === undefined) return undefined;

    return {
        id: message.id,
        chatId: chat.chatId,
        chatKind: chat.chatKind,
        sender: { id: message.author.id, displayName: displayName(message.author, message.member) },
        text: message.content,
        sentAt: typeof message.timestamp === 'string' ? message.timestamp : new Date().toISOString(),
    };
}

/**
 * The `InboundMessage.id` for an interaction: the interaction's id, marked, so `send` can tell a
 * reply to it (which goes through the interaction's own token) from a reply to a message.
 */
export const INTERACTION_ID_PREFIX = 'interaction:';
export const interactionMessageId = (interactionId: string): string => `${INTERACTION_ID_PREFIX}${interactionId}`;

/**
 * A slash command as the text the station would have read had it been typed, or a button press as
 * its action. Nothing for anything else, for a bot, or for a channel the operator has not allowed.
 */
export function interactionToInbound(interaction: DiscordInteraction, policy: ChannelPolicy): InboundMessage | undefined {
    const user = interaction.member?.user ?? interaction.user;
    if (user === undefined || user.bot === true) return undefined;

    const chat = allowedChannel(interaction.channel_id, interaction.guild_id, policy);
    if (chat === undefined) return undefined;

    const base = {
        id: interactionMessageId(interaction.id),
        chatId: chat.chatId,
        chatKind: chat.chatKind,
        sender: { id: user.id, displayName: displayName(user, interaction.member) },
        sentAt: new Date().toISOString(),
    };

    if (interaction.type === INTERACTION_COMMAND && typeof interaction.data?.name === 'string') {
        const args = (interaction.data.options ?? [])
            .map(option => (typeof option.value === 'string' ? option.value.trim() : ''))
            .filter(value => value !== '')
            .join(' ');
        return { ...base, text: args === '' ? `/${interaction.data.name}` : `/${interaction.data.name} ${args}` };
    }

    if (interaction.type === INTERACTION_COMPONENT && typeof interaction.data?.custom_id === 'string') {
        return { ...base, text: '', action: decodeAction(interaction.data.custom_id) };
    }

    return undefined;
}

/** Discord's limit on a component's `custom_id`, in characters. */
export const MAX_CUSTOM_ID_LENGTH = 100;

/** Discord's limit on a button's label, in characters. */
export const MAX_BUTTON_LABEL_LENGTH = 80;

/** What separates a button's id from its value in `custom_id`. An id never contains it. */
const ACTION_SEPARATOR = '|';

/**
 * A button's id and value as one `custom_id`, or nothing when they do not fit.
 *
 * Discord's button has no value of its own, so the value rides in the id, the way Telegram's
 * `callback_data` carries it.
 */
export function encodeAction(button: MessagingButton): string | undefined {
    if (button.id.includes(ACTION_SEPARATOR)) return undefined;
    const customId = button.value === undefined ? button.id : `${button.id}${ACTION_SEPARATOR}${button.value}`;
    return customId.length <= MAX_CUSTOM_ID_LENGTH ? customId : undefined;
}

/** `custom_id` back into the id and value it was made from. */
export function decodeAction(customId: string): MessagingAction {
    const at = customId.indexOf(ACTION_SEPARATOR);
    return at < 0 ? { id: customId } : { id: customId.slice(0, at), value: customId.slice(at + 1) };
}

/**
 * Buttons as action rows, up to five to a row and five rows at most, as Discord allows. A button
 * whose id and value do not fit in `custom_id` is left off rather than cut short, since a truncated
 * value would come back naming something else.
 */
export function actionRows(buttons: readonly MessagingButton[]): { rows: unknown[]; dropped: number } {
    const fitting = buttons.flatMap(button => {
        const customId = encodeAction(button);
        return customId === undefined ? [] : [{ type: 2, style: 1, custom_id: customId, label: clip(button.label, MAX_BUTTON_LABEL_LENGTH) }];
    });
    const kept = fitting.slice(0, 25);
    const rows = [];
    for (let index = 0; index < kept.length; index += 5) rows.push({ type: 1, components: kept.slice(index, index + 5) });
    return { rows, dropped: buttons.length - kept.length };
}

/** Discord's limit on a command's description. */
export const MAX_COMMAND_DESCRIPTION_LENGTH = 100;

/**
 * The station's commands as Discord application commands: a chat-input command each, and one
 * optional text option for any command that takes something after its name.
 */
export function applicationCommands(commands: readonly MessagingCommand[]): unknown[] {
    return commands
        .filter(command => /^[a-z0-9_-]{1,32}$/.test(command.name))
        .map(command => ({
            type: 1,
            name: command.name,
            description: clip(command.description, MAX_COMMAND_DESCRIPTION_LENGTH) || command.name,
            ...(command.takesArgs ? { options: [{ type: 3, name: 'text', description: 'What goes after the command', required: false }] } : {}),
        }));
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
 * Whether Discord refusing a send is worth trying again.
 *
 * A rate limit and anything on Discord's side, yes. A 400, a 403 (the bot cannot post there) and a
 * 404 (the channel is gone) will be refused the same way next time.
 */
export const isRetryableStatus = (status: number): boolean => status === 429 || status >= 500;
