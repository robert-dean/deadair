/**
 * The `messaging` kind. A messaging plugin connects the station to a chat
 * platform: Telegram, Slack, Discord and whatever comes after them. People write
 * to the station there, and the station answers and announces there.
 *
 * ## The host asks, and the plugin never pushes
 *
 * A plugin has no inbound HTTP and no way to call into the station on its own,
 * so incoming messages are PULLED: the host calls {@link MessagingProvider.receive}
 * in a loop it owns, one call at a time per plugin, handing back the cursor the
 * previous call returned. The plugin turns that into whatever its platform
 * offers (Telegram's `getUpdates` offset, a Slack `oldest` timestamp, a Discord
 * `after` snowflake). The host stores the cursor durably, so a restart neither
 * replays a command nor loses one.
 *
 * A platform that can only deliver by webhook does not fit this capability yet,
 * and that is a known gap rather than an oversight.
 *
 * ## The plugin decides which chats count
 *
 * Chat ids are the platform's own vocabulary, so the list of chats the station
 * listens in is the plugin's configuration and the filtering is the plugin's
 * job. A message {@link MessagingProvider.receive} returns is one the host should
 * act on. Messages from bots, including this one, are the plugin's to drop.
 *
 * ## What a person writes is untrusted, always
 *
 * {@link InboundMessage.text} is whatever somebody typed. The host treats it as
 * data wherever it goes, and a plugin must not pre-process it into anything that
 * looks like the station's own words.
 *
 * ## Plain text, and buttons
 *
 * {@link OutboundMessage.text} is plain text. A platform that parses markup is
 * the plugin's to escape for, since the host cannot know which characters a
 * given platform treats as formatting.
 *
 * A message may carry {@link MessagingButton}s. Pressing one comes back from
 * {@link MessagingProvider.receive} as an {@link InboundMessage} with an
 * {@link InboundMessage.action}, carrying the button's `id` and `value` exactly
 * as they were sent. How the two travel through the platform (Telegram's
 * `callback_data`, a Slack `action_id`) is the plugin's business; the shapes
 * match `@maroonedsoftware/comms`' `OutgoingButton` and `IncomingEvent.action`,
 * which is what the host routes them with. A platform with no buttons renders
 * them as text or drops them.
 *
 * Every shape here is JSON-safe.
 */

/** Whether a message arrived one to one, or in a chat with several people. */
export type MessagingChatKind = 'direct' | 'group';

/** Who wrote a message, as the platform identifies them. */
export interface MessagingSender {
    /**
     * The platform's stable id for this person.
     *
     * Stable is the requirement: a linked account and a request cooldown are
     * both keyed on it, so a display name or a handle a person can change is
     * the wrong thing to put here.
     */
    id: string;
    /** What to call them. Whatever the platform shows; never used as a key. */
    displayName: string;
}

/** One message somebody sent to the station. */
export interface InboundMessage {
    /** The platform's id for this message, unique within its chat. */
    id: string;
    /** Where it was written. Handed back as {@link OutboundMessage.chatId} to answer it. */
    chatId: string;
    chatKind: MessagingChatKind;
    sender: MessagingSender;
    /** What they wrote, verbatim. Untrusted. Empty when this is a button press. */
    text: string;
    /**
     * Present when this is somebody pressing a button rather than writing: the
     * button's `id` and `value` exactly as {@link OutboundMessage.buttons} sent
     * them. The message's own {@link id} is then the message the button was on,
     * so a reply threads under it. Untrusted like the text: a
     * platform lets a client send any value it likes.
     */
    action?: MessagingAction;
    /** When it was sent, as an ISO-8601 string. */
    sentAt: string;
}

/** A button pressed, as it came back. */
export interface MessagingAction {
    id: string;
    value?: string;
}

/** A button on an outgoing message. The shape of `@maroonedsoftware/comms`' `OutgoingButton`. */
export interface MessagingButton {
    /** What the press is routed by. Short: platforms bound it (Telegram allows 64 bytes for id and value together). */
    id: string;
    /** What the button says. */
    label: string;
    /** Carried back with the press, for a button about one thing among several. */
    value?: string;
}

/** What {@link MessagingProvider.receive} is asked. */
export interface MessagingReceiveQuery {
    /**
     * The cursor the previous call returned, or absent on the first call ever.
     *
     * Opaque to the host: it stores it and hands it back, and never reads it.
     * Absent means "start from now", not "replay everything the platform still
     * holds", since a command written last week is not one to act on today.
     */
    cursor?: string;
    /**
     * How long the plugin may hold the call open waiting for something to
     * arrive, in integer milliseconds.
     *
     * A long poll where the platform has one; a plugin whose platform does not
     * answers straight away, and the host paces its own loop. The host's call
     * timeout is set comfortably above this.
     */
    waitMs: number;
}

/** What {@link MessagingProvider.receive} answers. */
export interface MessagingReceiveResult {
    /** New messages, oldest first. Empty when nothing arrived. */
    messages: InboundMessage[];
    /**
     * Where to resume next time. Absent keeps the one the host already holds.
     *
     * Return it past every message the platform delivered, including the ones
     * the plugin filtered out, or the host will ask for them again forever.
     */
    cursor?: string;
}

/** A message the station sends. */
export interface OutboundMessage {
    /** A chat id, as an {@link InboundMessage} or an {@link MessagingAnnounceTarget} carried it. */
    chatId: string;
    /** Plain text. See the module doc on escaping. */
    text: string;
    /** Answer this message in particular, where the platform threads replies. */
    replyToId?: string;
    /** Buttons under the message. See the module doc. */
    buttons?: MessagingButton[];
}

/** What became of one {@link MessagingProvider.send}. */
export interface MessagingSendResult {
    delivered: boolean;
    /** When not delivered: what the platform said, summarized by the plugin. Never the raw body. */
    reason?: string;
    /**
     * When not delivered: whether sending it again could work.
     *
     * `true` for a timeout, a 5xx, a rate limit. `false` for a chat the bot was
     * removed from, a blocked bot, a message the platform refuses. Absent means
     * `false`, for the reason the scrobble capability gives: a message retried
     * forever is a queue that never drains.
     */
    retryable?: boolean;
}

/**
 * Something the station can tell a chat about without being asked.
 *
 * A closed vocabulary that grows when the host has a new moment to announce.
 */
export type MessagingAnnouncement = 'nowPlaying';

/** A chat that wants announcements, and which ones. */
export interface MessagingAnnounceTarget {
    chatId: string;
    announcements: MessagingAnnouncement[];
}

/**
 * Implemented by a `messaging` plugin.
 */
export interface MessagingProvider {
    /**
     * Fetch what has arrived since {@link MessagingReceiveQuery.cursor}.
     *
     * THROW when the platform could not be reached or refused the credentials.
     * The host backs off and asks again with the same cursor, so nothing is lost.
     */
    receive(query: MessagingReceiveQuery): Promise<MessagingReceiveResult>;

    /**
     * Send one message.
     *
     * Answer with a {@link MessagingSendResult} for anything the platform said;
     * throw only when it could not be reached at all, which the host treats as
     * retryable.
     */
    send(message: OutboundMessage): Promise<MessagingSendResult>;

    /**
     * Whether this plugin wants to be polled and written to at all right now.
     *
     * Optional, and ABSENT MEANS YES. Keep it a config read.
     */
    accepting?(): Promise<boolean>;

    /**
     * Which chats want which announcements.
     *
     * Optional, and absent means none: a plugin that only answers when spoken
     * to never has to write it. Asked each time there is something to announce,
     * so a config change takes effect on the next one. Keep it a config read.
     */
    announceTargets?(): Promise<MessagingAnnounceTarget[]>;
}
