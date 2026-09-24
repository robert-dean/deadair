import {
    Plugin,
    PluginError,
    type HostFetchMethod,
    type InboundMessage,
    type MessagingAnnounceTarget,
    type MessagingCommand,
    type MessagingPluginInstance,
    type MessagingReceiveQuery,
    type MessagingReceiveResult,
    type MessagingSendResult,
    type OutboundMessage,
    type PluginConnectionResult,
    type PluginErrorCode,
    type PluginHost,
} from '@deadair/plugin-sdk';
import { DiscordClient, IsDiscordError, type DiscordConfig as ClientConfig } from '@maroonedsoftware/discord';
import { GatewayClient, Intents } from '@maroonedsoftware/discord/gateway';

import {
    INTERACTION_COMMAND,
    INTERACTION_COMPONENT,
    INTERACTION_ID_PREFIX,
    actionRows,
    applicationCommands,
    clip,
    configFlag,
    configLines,
    interactionToInbound,
    isRetryableStatus,
    messageToInbound,
    type ChannelPolicy,
    type DiscordInteraction,
    type DiscordMessage,
} from './discord.events.js';
import { DISCORD_API_HOST, MAX_MESSAGE_LENGTH, REQUEST_TIMEOUT_MS } from './discord.manifest.js';

export { discordManifest } from './discord.manifest.js';

/** What the bot asks the Gateway for: servers, the messages in them and in direct messages, and what those messages say. */
export const GATEWAY_INTENTS = Intents.GUILDS | Intents.GUILD_MESSAGES | Intents.DIRECT_MESSAGES | Intents.MESSAGE_CONTENT;

/**
 * How long an interaction's token is used to answer it. Discord honours one for fifteen minutes; a
 * minute less leaves room for a reply already on its way.
 */
export const INTERACTION_TOKEN_MS = 14 * 60_000;

/**
 * The most messages held for the station between two polls.
 *
 * The host polls again the moment a poll returns, so this only fills while the station is not
 * listening at all (quarantined, or mid-reinit), and what arrives then is stale by the time it is
 * read. The oldest go first.
 */
export const MAX_HELD_MESSAGES = 200;

/** What a failed REST call said, read off a `DiscordError`'s internal details. */
interface Refusal {
    /** The HTTP status, or absent when the call never reached Discord. */
    status?: number;
    description: string;
}

/** An interaction the station has not finished answering, by the id `receive` handed out for it. */
interface HeldInteraction {
    token: string;
    /** A slash command is answered by replacing its "thinking" placeholder first; a button press by a new message. */
    kind: 'command' | 'button';
    answered: boolean;
    heldAt: number;
}

/**
 * The station on Discord.
 *
 * ## Over the Gateway, because Discord pushes
 *
 * Slash commands and button presses reach a bot only at a public interactions URL or over the
 * Gateway, the WebSocket a bot holds open, and a plugin has no public URL. So the plugin holds a
 * Gateway session through `host.socket`, driven by ServerKit's `GatewayClient` (heartbeat, identify,
 * resume), and puts what it hears in a queue; `receive` is the host draining that queue, waiting on
 * it when it is empty. Nothing is stored: a message that arrived while the station was not listening
 * is lost with the process, and a missed `/now` is not worth a table.
 *
 * The session starts on the first `receive`, not in `onLoad`: init has a few seconds and a first
 * connect is a REST call and a handshake, and a failure there is then the poll's to report, which
 * is what the breaker and the plugin page read.
 *
 * ## Deferred at once, answered by the host
 *
 * Discord gives an interaction three seconds to be acknowledged, and the host answers when its turn
 * comes. So every interaction is deferred the moment it arrives (a slash command shows "thinking",
 * a button press shows nothing), and its token is held against the id `receive` hands out for it.
 * A `send` replying to that id answers through the token; one replying to anything else is an
 * ordinary message in the channel.
 *
 * ## The host is captured before the first await
 *
 * For `plugins/weather`'s reason, and more so here: the Gateway calls back from its own timers and
 * the socket's events, long after any call into the plugin, so everything it runs holds the host it
 * was started with rather than reading `this.host`.
 */
export class DiscordPlugin extends Plugin implements MessagingPluginInstance {
    private token = '';
    private policy: ChannelPolicy = { directMessages: true, channels: new Set() };
    private announceChannels: string[] = [];

    private gateway?: GatewayClient;
    /** Why the Gateway stopped for good, until a config save starts again from scratch. */
    private fatal?: { message: string; code: PluginErrorCode };
    private applicationId?: string;

    private readonly inbox: InboundMessage[] = [];
    private wake?: () => void;
    private overflowed = false;
    private readonly interactions = new Map<string, HeldInteraction>();
    /** Channels somebody spoke in that are not on the list, each logged once so the operator can find its id. */
    private readonly unlistedChannels = new Set<string>();

    protected async onLoad(): Promise<void> {
        const config = await this.host.config.get();

        this.token = (await this.host.secrets.get('botToken'))?.trim() ?? '';
        this.policy = {
            directMessages: configFlag(config.directMessages, true),
            channels: new Set(configLines(config.channels)),
        };
        this.announceChannels = configLines(config.announceChannels);

        this.register(() => {
            this.gateway?.stop();
            this.gateway = undefined;
            this.wake?.();
            this.inbox.length = 0;
            this.interactions.clear();
            this.unlistedChannels.clear();
        });

        this.host.logger.info('discord ready', {
            configured: this.token !== '',
            directMessages: this.policy.directMessages,
            channels: this.policy.channels.size,
            announcing: this.announceChannels.length,
        });
    }

    protected async onUnload(): Promise<void> {
        this.token = '';
    }

    /** Only when there is a token: without one every call is a 401 and the poller would back off forever for nothing. */
    async accepting(): Promise<boolean> {
        return this.token !== '';
    }

    async announceTargets(): Promise<MessagingAnnounceTarget[]> {
        return this.announceChannels.map(chatId => ({ chatId, announcements: ['nowPlaying'] }));
    }

    async testConnection(): Promise<PluginConnectionResult> {
        const host = this.host;
        if (this.token === '') return { ok: false, message: 'No bot token set.' };
        if (this.fatal !== undefined) return { ok: false, message: this.fatal.message };

        const client = this.client(host);
        try {
            const me = (await client.getCurrentUser()) as { username?: unknown };
            await client.getGatewayBot();
            const name = typeof me.username === 'string' ? me.username : 'the bot';
            return { ok: true, message: `Connected as ${name}.` };
        } catch (error) {
            return { ok: false, message: this.explain(this.refusal(error)) };
        }
    }

    /**
     * Registers the station's commands as global slash commands, replacing whatever was there, so the
     * list Discord offers is always the station's own. Idempotent, which is what being told on every
     * start needs.
     */
    async commands(commands: MessagingCommand[]): Promise<void> {
        const host = this.host;
        if (this.token === '') return;

        try {
            const applicationId = await this.resolveApplicationId(host);
            await this.client(host, applicationId).bulkOverwriteGlobalCommands(applicationCommands(commands));
        } catch (error) {
            if (error instanceof PluginError) throw error;
            const refusal = this.refusal(error);
            throw new PluginError(this.explain(refusal)).withCode(codeFor(refusal));
        }
    }

    async receive(query: MessagingReceiveQuery): Promise<MessagingReceiveResult> {
        const host = this.host;
        if (this.token === '') throw new PluginError('No bot token set.').withCode('config');
        if (this.fatal !== undefined) throw new PluginError(this.fatal.message).withCode(this.fatal.code);

        await this.connect(host);

        if (this.inbox.length === 0 && query.waitMs > 0) await this.waitForMessages(query.waitMs);
        return { messages: this.inbox.splice(0) };
    }

    async send(message: OutboundMessage): Promise<MessagingSendResult> {
        const host = this.host;
        if (this.token === '') return { delivered: false, reason: 'no bot token set', retryable: false };

        const text = clip(message.text, MAX_MESSAGE_LENGTH);
        const buttons = message.buttons === undefined || message.buttons.length === 0 ? undefined : actionRows(message.buttons);
        if (buttons !== undefined && buttons.dropped > 0)
            host.logger.warn('discord: left off buttons Discord would not take', { dropped: buttons.dropped });

        // No mentions, ever: the text can carry a listener's words, and nobody asked for a ping.
        const body = {
            content: text,
            allowed_mentions: { parse: [] },
            ...(buttons === undefined || buttons.rows.length === 0 ? {} : { components: buttons.rows }),
        };

        try {
            const held = this.heldInteraction(message.replyToId);
            if (held !== undefined) {
                const client = this.client(host, await this.resolveApplicationId(host));
                if (held.kind === 'command' && !held.answered) await client.editOriginalInteractionResponse(held.token, body);
                else await client.createFollowupMessage(held.token, body);
                held.answered = true;
                return { delivered: true };
            }

            const replyTo = message.replyToId === undefined || message.replyToId.startsWith(INTERACTION_ID_PREFIX) ? undefined : message.replyToId;
            await this.client(host).createMessage(message.chatId, {
                ...body,
                ...(replyTo === undefined ? {} : { message_reference: { message_id: replyTo, fail_if_not_exists: false } }),
            });
            return { delivered: true };
        } catch (error) {
            const refusal = error instanceof PluginError ? { description: error.message } : this.refusal(error);
            // A call that never reached Discord is worth another go, as the SDK says a throw would be.
            return { delivered: false, reason: this.explain(refusal), retryable: refusal.status === undefined || isRetryableStatus(refusal.status) };
        }
    }

    /** Opens the Gateway session if there is none. Throws what the first connect threw, as the poll's failure. */
    private async connect(host: PluginHost): Promise<void> {
        if (this.gateway !== undefined) return;

        const client = this.client(host);
        const gateway = new GatewayClient({
            token: this.token,
            intents: GATEWAY_INTENTS,
            gatewayUrl: async () => (await client.getGatewayBot()).url,
            connect: url => host.socket(url),
            onDispatch: (event, data) => this.onDispatch(host, event, data),
            logger: serverkitLogger(host),
            onError: error => {
                const code = typeof error.internalDetails?.code === 'number' ? error.internalDetails.code : undefined;
                this.fatal = fatalFor(code, error.message);
                host.logger.error('discord: the Gateway stopped for good', { code, reason: this.fatal.message });
                this.gateway = undefined;
                this.wake?.();
            },
        });
        this.gateway = gateway;

        try {
            await gateway.start();
        } catch (error) {
            this.gateway = undefined;
            if (error instanceof PluginError) throw error;
            const refusal = this.refusal(error);
            throw new PluginError(this.explain(refusal)).withCode(codeFor(refusal));
        }
    }

    /** Everything the Gateway dispatches. Never throws: it runs on the socket's own turn. */
    private onDispatch(host: PluginHost, event: string, data: unknown): void {
        if (event === 'READY') {
            const ready = data as { user?: { username?: unknown }; application?: { id?: unknown } };
            if (typeof ready.application?.id === 'string') this.applicationId = ready.application.id;
            host.logger.info('discord: connected to the Gateway', {
                ...(typeof ready.user?.username === 'string' ? { as: ready.user.username } : {}),
            });
            return;
        }

        if (event === 'MESSAGE_CREATE') {
            const message = data as DiscordMessage;
            const inbound = messageToInbound(message, this.policy);
            if (inbound !== undefined) this.deliver(host, inbound);
            else this.noteUnlistedChannel(host, message.channel_id, message.guild_id);
            return;
        }

        if (event === 'INTERACTION_CREATE') void this.onInteraction(host, data as DiscordInteraction);
    }

    /**
     * A slash command or a button press: deferred before anything else, then queued for the host.
     *
     * One from a channel the station does not answer in is still answered, with a line only the
     * person who asked can see, because an interaction nobody acknowledges shows them "the application
     * did not respond", which reads as the bot being broken.
     */
    private async onInteraction(host: PluginHost, interaction: DiscordInteraction): Promise<void> {
        if (interaction.type !== INTERACTION_COMMAND && interaction.type !== INTERACTION_COMPONENT) return;
        const client = this.client(host);

        const inbound = interactionToInbound(interaction, this.policy);
        if (inbound === undefined) {
            this.noteUnlistedChannel(host, interaction.channel_id, interaction.guild_id);
            await client
                .createInteractionResponse(interaction.id, interaction.token, {
                    type: 4,
                    data: { content: 'The station is not listening in this channel.', flags: 64, allowed_mentions: { parse: [] } },
                })
                .catch((error: unknown) =>
                    host.logger.debug('discord: could not turn away an interaction', { reason: this.refusal(error).description }),
                );
            return;
        }

        const kind = interaction.type === INTERACTION_COMMAND ? 'command' : 'button';
        try {
            await client.deferInteraction(interaction, kind === 'command' ? 'message' : 'update');
        } catch (error) {
            // Past its three seconds, or refused. Nothing will be able to answer it, so it is not queued.
            host.logger.warn('discord: could not acknowledge an interaction in time', { reason: this.refusal(error).description });
            return;
        }

        this.pruneInteractions();
        this.interactions.set(inbound.id, { token: interaction.token, kind, answered: false, heldAt: Date.now() });
        this.deliver(host, inbound);
    }

    /** Queues one message for the next `receive`, dropping the oldest past the cap. */
    private deliver(host: PluginHost, message: InboundMessage): void {
        this.inbox.push(message);
        if (this.inbox.length > MAX_HELD_MESSAGES) {
            this.inbox.shift();
            if (!this.overflowed) host.logger.warn('discord: messages arrived faster than the station read them; dropping the oldest');
            this.overflowed = true;
        }
        this.wake?.();
    }

    /** Waits until a message is queued, the wait runs out, or the plugin is disposed. */
    private waitForMessages(waitMs: number): Promise<void> {
        return new Promise(resolve => {
            const done = (): void => {
                clearTimeout(timer);
                if (this.wake === done) this.wake = undefined;
                resolve();
            };
            const timer = setTimeout(done, waitMs);
            this.wake = done;
        });
    }

    /** The held interaction a reply is to, if it is still young enough to answer through. */
    private heldInteraction(replyToId: string | undefined): HeldInteraction | undefined {
        if (replyToId === undefined || !replyToId.startsWith(INTERACTION_ID_PREFIX)) return undefined;
        const held = this.interactions.get(replyToId);
        if (held === undefined || Date.now() - held.heldAt > INTERACTION_TOKEN_MS) return undefined;
        return held;
    }

    private pruneInteractions(): void {
        const now = Date.now();
        for (const [id, held] of this.interactions) if (now - held.heldAt > INTERACTION_TOKEN_MS) this.interactions.delete(id);
    }

    /**
     * The application's id, which answering an interaction and registering commands both need.
     *
     * Read off the Gateway's `READY` when there has been one, and asked of the API otherwise, rather
     * than being a setting: for a bot the token already says which application it is.
     */
    private async resolveApplicationId(host: PluginHost): Promise<string> {
        if (this.applicationId !== undefined) return this.applicationId;
        const app = (await this.client(host).request('GET', '/applications/@me')) as { id?: unknown } | undefined;
        if (typeof app?.id !== 'string') throw new PluginError('Discord did not say which application this bot belongs to.').withCode('upstream');
        this.applicationId = app.id;
        return app.id;
    }

    /** A REST client for one call, speaking through the host's fetch. */
    private client(host: PluginHost, applicationId = ''): DiscordClient {
        const config: ClientConfig = {
            botToken: this.token,
            applicationId,
            apiBaseUrl: `https://${DISCORD_API_HOST}/api/v10`,
            requestTimeoutMs: REQUEST_TIMEOUT_MS,
            fetch: (url, init) =>
                host.fetch(url, {
                    method: init.method as HostFetchMethod,
                    headers: init.headers,
                    ...(init.body === undefined ? {} : { body: init.body }),
                    signal: init.signal,
                    // The client's signal carries the real deadline; this is only the host's ceiling.
                    timeoutMs: host.remainingMs(),
                }),
        };
        return new DiscordClient(config, serverkitLogger(host));
    }

    /** What went wrong, from a `DiscordError` or anything else, with the token scrubbed. */
    private refusal(error: unknown): Refusal {
        if (IsDiscordError(error)) {
            const details = (error.internalDetails ?? {}) as { status?: unknown; body?: unknown; reason?: unknown };
            const described = discordMessage(details.body) ?? (typeof details.reason === 'string' ? details.reason : error.message);
            return { ...(typeof details.status === 'number' ? { status: details.status } : {}), description: this.scrub(described) };
        }
        return { description: this.scrub(error instanceof Error ? error.message : String(error)) };
    }

    /** A refusal in words an operator can act on. */
    private explain(refusal: Refusal): string {
        if (refusal.status === 401) return `Discord did not accept the bot token (${refusal.description}).`;
        if (refusal.status === 403) return `Discord would not let the bot do that (${refusal.description}).`;
        if (refusal.status === undefined) return `Could not reach Discord: ${refusal.description}`;
        return `Discord refused: ${refusal.description}`;
    }

    /** `text` with the token replaced, for the last line of defence before anything leaves this file. */
    private scrub(text: string): string {
        return this.token === '' ? text : text.split(this.token).join('<token>');
    }

    /** Log a channel's id the first time somebody there speaks, so the operator can add it to the list. */
    private noteUnlistedChannel(host: PluginHost, channelId: string | undefined, guildId: string | undefined): void {
        if (channelId === undefined || guildId === undefined) return;
        if (this.policy.channels.has(channelId) || this.unlistedChannels.has(channelId)) return;

        this.unlistedChannels.add(channelId);
        host.logger.info('discord: a channel that is not on the list spoke; add its id to answer there', { channelId, guildId });
    }
}

/** Discord's own sentence out of an error body, when the body is its JSON. */
function discordMessage(body: unknown): string | undefined {
    if (typeof body !== 'string' || body === '') return undefined;
    try {
        const parsed = JSON.parse(body) as { message?: unknown };
        return typeof parsed.message === 'string' ? parsed.message : undefined;
    } catch {
        return undefined;
    }
}

/** The host's vocabulary for a refused call: the token, a rate limit, or anything else upstream. */
function codeFor(refusal: Refusal): PluginErrorCode {
    if (refusal.status === 401) return 'auth';
    if (refusal.status === 403) return 'config';
    if (refusal.status === 429) return 'rate_limited';
    return refusal.status === undefined ? 'unavailable' : 'upstream';
}

/** A Gateway close Discord says not to retry, in words and a code the plugin page can show. */
function fatalFor(code: number | undefined, message: string): { message: string; code: PluginErrorCode } {
    if (code === 4004) return { message: 'Discord did not accept the bot token. Reset it on the Bot page and paste the new one.', code: 'auth' };
    if (code === 4014) {
        return {
            message: 'Discord refused the Message Content Intent. Turn it on under Privileged Gateway Intents on the Bot page, then save here again.',
            code: 'config',
        };
    }
    return { message: `Discord closed the Gateway and said not to reconnect: ${message}`, code: 'config' };
}

/** The plugin's logger in the shape ServerKit's clients take. */
function serverkitLogger(host: PluginHost) {
    const meta = (rest: unknown[]): Record<string, unknown> | undefined => {
        const first = rest[0];
        return first !== null && typeof first === 'object' && !Array.isArray(first) ? (first as Record<string, unknown>) : undefined;
    };
    return {
        error: (message: unknown, ...rest: unknown[]) => host.logger.error(String(message), meta(rest)),
        warn: (message: unknown, ...rest: unknown[]) => host.logger.warn(String(message), meta(rest)),
        info: (message: unknown, ...rest: unknown[]) => host.logger.info(String(message), meta(rest)),
        debug: (message: unknown, ...rest: unknown[]) => host.logger.debug(String(message), meta(rest)),
        trace: (message: unknown, ...rest: unknown[]) => host.logger.debug(String(message), meta(rest)),
    };
}
