import { Injectable } from 'injectkit';
import type { InboundMessage } from '@deadair/plugin-sdk';
import { NowPlayingService } from '#modules/nowplaying/nowplaying.service.js';
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

interface CommandDefinition {
    /** One line for `/help`. */
    summary: string;
    run(context: CommandContext): Promise<string>;
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

    const artist = track.artist.trim() === '' ? '' : ` by ${track.artist}`;
    const album = track.album === undefined || track.album.trim() === '' ? '' : ` (${track.album})`;
    return `Now playing on ${station}: ${track.title}${artist}${album}${programme}`;
}

@Injectable()
export class MessagingCommands {
    private readonly commands: ReadonlyMap<string, CommandDefinition>;

    constructor(private readonly nowPlaying: NowPlayingService) {
        this.commands = new Map<string, CommandDefinition>([
            ['now', { summary: 'what is on air right now', run: async () => describeNowPlaying(this.nowPlaying.getNowPlaying()) }],
            ['help', { summary: 'what you can ask', run: async () => this.help() }],
        ]);
    }

    /**
     * The answer to one message, or nothing when the station should stay quiet.
     *
     * Quiet for anything that is not a command in a group chat, and for a command this table does
     * not know in one: another bot in the same group may well answer to it.
     */
    async answer(pluginId: string, message: InboundMessage): Promise<string | undefined> {
        const command = parseCommand(message.text);
        if (command === undefined) return message.chatKind === 'direct' ? this.help() : undefined;

        // Telegram sends `/start` the first time anybody opens a chat with a bot, so it is answered
        // as a greeting rather than as a command nobody typed.
        if (command.name === 'start') return this.help();

        const definition = this.commands.get(command.name);
        if (definition === undefined) return message.chatKind === 'direct' ? `I don't know /${command.name}.\n\n${this.help()}` : undefined;

        return definition.run({ pluginId, message, args: command.args });
    }

    private help(): string {
        const lines = [...this.commands.entries()].map(([name, definition]) => `/${name} ${definition.summary}`);
        return `You can ask me:\n${lines.join('\n')}`;
    }
}
