import { Injectable } from 'injectkit';
import { ChannelRouter, type IncomingEvent, type Reply } from '@maroonedsoftware/comms';
import type { InboundMessage } from '@deadair/plugin-sdk';
import { NowPlayingService } from '#modules/nowplaying/nowplaying.service.js';
import { MessagingOperator } from './messaging.operator.js';
import { MessagingRequests, REQUEST_PICK_ACTION } from './messaging.requests.js';
import type { NowPlaying } from '#modules/nowplaying/types/nowplaying.types.js';

/**
 * What people can say to the station on a chat platform, and what it says back.
 *
 * ## Commands, not conversation
 *
 * A message is acted on only when it is a command: a leading `/`, a name, and whatever follows. The
 * shape every chat platform already teaches its users, and the one that keeps the station quiet in a
 * group chat where people are talking to each other rather than to it. In a DIRECT chat anything
 * that is not a command is answered with the list of what is, because somebody writing to the
 * station one to one is writing to it.
 *
 * Nothing a person writes reaches a model here. What they typed is matched against a closed table
 * of names and otherwise ignored, which is the whole of this file's answer to the text being
 * untrusted.
 *
 * ## Routed by ServerKit's `comms`
 *
 * The table is a `ChannelRouter` from `@maroonedsoftware/comms`: commands by name, button presses
 * by action id, everything else to the message handler, and what nothing claims to the fallback.
 * Each platform is a channel named by its plugin id. The router is the same one ServerKit's own
 * channel adapters dispatch into, so a handler written here is written once for every platform, and
 * a template registered on `router.templates` renders natively where a platform has a renderer and
 * as plain text everywhere else.
 */

/** A command as it was written: `/now@deadair_bot soon` is `now` with `soon` after it. */
export interface ParsedCommand {
    /** Lower-cased, with any `@botname` suffix removed. */
    name: string;
    /** Whatever followed the name, trimmed. Empty when nothing did. */
    args: string;
}

/** What a command handler is given. */
export interface CommandContext {
    /** Which messaging plugin it arrived through. */
    pluginId: string;
    message: InboundMessage;
    args: string;
}

/** The most a command name may be. Longer is somebody's sentence that happened to start with `/`. */
const MAX_COMMAND_NAME = 32;

/**
 * Read a command out of a message, or nothing when it is not one.
 *
 * Exported for the tests. The `@suffix` is dropped without checking it names this bot: a platform
 * that delivered the message to this plugin has already decided who it was for.
 */
export function parseCommand(text: string): ParsedCommand | undefined {
    const match = /^\/([A-Za-z][A-Za-z0-9_]*)(?:@\S+)?(?:\s+([\s\S]*))?$/.exec(text.trim());
    if (!match) return undefined;

    const name = (match[1] as string).toLowerCase();
    if (name.length > MAX_COMMAND_NAME) return undefined;

    return { name, args: (match[2] ?? '').trim() };
}

/** The `/now` answer, in the station's own words. Exported for the tests. */
export function describeNowPlaying(nowPlaying: NowPlaying): string {
    const { station, track, show } = nowPlaying;
    if (!nowPlaying.onAir || track === undefined) return `${station} is off the air right now.`;

    const programme = show === undefined ? '' : show.host === undefined ? `\n${show.name}` : `\n${show.name}, with ${show.host}`;
    if (track.kind === 'break') return `${station} is talking right now: ${track.title}${programme}`;

    return `${describeRecord(station, track)}${programme}`;
}

/** One record, as the station announces it: `Now playing on Dead Air: Teardrop by Massive Attack (Mezzanine)`. */
export function describeRecord(station: string, record: { title: string; artist: string; album?: string }): string {
    const artist = record.artist.trim() === '' ? '' : ` by ${record.artist}`;
    const album = record.album === undefined || record.album.trim() === '' ? '' : ` (${record.album})`;
    return `Now playing on ${station}: ${record.title}${artist}${album}`;
}

/** The message a comms event was made from. Every event here carries one as its `raw`. */
export const inboundOf = (event: IncomingEvent): InboundMessage => event.raw as InboundMessage;

/**
 * One message as the event `comms` routes: a button press is an `action`, a `/command` a `command`,
 * anything else a `message`. The channel is the plugin id, so a handler can tell platforms apart
 * without the router needing to. Exported for the tests.
 */
export function toIncomingEvent(pluginId: string, message: InboundMessage): IncomingEvent {
    const base = {
        channel: pluginId,
        user: { id: message.sender.id, username: message.sender.displayName },
        conversation: { id: message.chatId },
        raw: message,
    };
    if (message.action !== undefined) return { ...base, kind: 'action', action: { ...message.action } };

    const command = parseCommand(message.text);
    if (command !== undefined) return { ...base, kind: 'command', text: message.text, command };
    return { ...base, kind: 'message', text: message.text };
}

@Injectable()
export class MessagingCommands {
    /** The router every message is dispatched through. Public so a later handler (a request's buttons) can register on it. */
    readonly router = new ChannelRouter();
    private readonly summaries: Array<{ name: string; summary: string; operator: boolean }> = [];

    constructor(
        private readonly nowPlaying: NowPlayingService,
        private readonly operator: MessagingOperator,
        private readonly requests: MessagingRequests,
    ) {
        this.command('now', 'what is on air right now', false, async () => describeNowPlaying(this.nowPlaying.getNowPlaying()));

        // Answered with a message rather than a line of text, since "which one did you mean" carries buttons.
        this.summaries.push({ name: 'request', summary: 'TITLE OR ARTIST, then for NAME: MESSAGE if you like: ask for a record', operator: false });
        this.router.command('request', async (event, reply) =>
            reply.send(await this.requests.request(event.channel, inboundOf(event), event.command?.args ?? '')),
        );
        this.router.action(REQUEST_PICK_ACTION, async (event, reply) =>
            reply.send(await this.requests.pick(event.channel, inboundOf(event), event.action?.value)),
        );

        this.command('help', 'what you can ask', false, async () => this.help());
        this.command('link', 'CODE: link this account to your station account', true, async c => this.operator.link(c.pluginId, c.message, c.args));
        this.command('unlink', 'undo /link', true, async c => this.operator.unlink(c.pluginId, c.message));
        this.command('skip', 'skip what is playing', true, async c => this.operator.operate(c.pluginId, c.message, 'skip'));
        this.command('offair', 'take the station off the air', true, async c => this.operator.operate(c.pluginId, c.message, 'offair'));
        this.command('onair', 'put it back on the air where it stopped', true, async c => this.operator.operate(c.pluginId, c.message, 'onair'));

        // Telegram sends `/start` the first time anybody opens a chat with a bot, so it is answered as
        // a greeting rather than as a command nobody typed. Not listed in `/help`.
        this.router.command('start', async (_event, reply) => reply.send({ text: this.help() }));

        // Anything that is not a command: answered one to one, where somebody is writing to the
        // station, and ignored in a group, where people are talking to each other.
        this.router.message(async (event, reply) => {
            if (inboundOf(event).chatKind === 'direct') await reply.send({ text: this.help() });
        });

        // A command or a button nothing here knows. Quiet in a group, where another bot may answer
        // to it; said in a direct chat. An unknown button is always quiet: nobody typed it.
        this.router.fallback(async (event, reply) => {
            if (event.kind !== 'command' || inboundOf(event).chatKind !== 'direct') return;
            await reply.send({ text: `I don't know /${event.command?.name ?? ''}.\n\n${this.help()}` });
        });
    }

    /** Route one message from one platform, answering through `reply`. */
    async dispatch(pluginId: string, message: InboundMessage, reply: Reply): Promise<void> {
        await this.router.dispatch(toIncomingEvent(pluginId, message), reply);
    }

    /** Register a command that answers with text, and list it in `/help`. */
    private command(name: string, summary: string, operator: boolean, run: (context: CommandContext) => Promise<string>): void {
        this.summaries.push({ name, summary, operator });
        this.router.command(name, async (event, reply) => {
            const text = await run({ pluginId: event.channel, message: inboundOf(event), args: event.command?.args ?? '' });
            await reply.send({ text });
        });
    }

    private help(): string {
        const line = (entry: { name: string; summary: string }) => `/${entry.name} ${entry.summary}`;
        const everyone = this.summaries.filter(entry => !entry.operator).map(line);
        const operators = this.summaries.filter(entry => entry.operator).map(line);
        return `You can ask me:\n${everyone.join('\n')}\n\nStation operators, once linked:\n${operators.join('\n')}`;
    }
}
