import {
    Plugin,
    PluginError,
    type HostFetchMethod,
    type InboundMessage,
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
import {
    IsSlackError,
    SlackClient,
    type SlackCommandPayload,
    type SlackConfig,
    type SlackEventCallback,
    type SlackInteractionPayload,
} from '@maroonedsoftware/slack';
import { SocketModeClient } from '@maroonedsoftware/slack/socketmode';

import {
    AUTH_ERRORS,
    actionsBlock,
    allowedChannel,
    clip,
    configFlag,
    configLines,
    decodeAction,
    escapeSlack,
    isDirectChannel,
    isPersonTalking,
    tsToIso,
    unescapeSlack,
    type ChannelPolicy,
    type SlackMessageEvent,
} from './slack.events.js';
import { MAX_MESSAGE_LENGTH, REQUEST_TIMEOUT_MS, SLACK_API_HOST } from './slack.manifest.js';

export { slackManifest } from './slack.manifest.js';

/**
 * How long a `response_url` is used to answer the command or press it came with. Slack honours one
 * for thirty minutes and five uses; a minute less leaves room for a reply already on its way.
 */
export const RESPONSE_URL_MS = 29 * 60_000;
export const RESPONSE_URL_USES = 5;

/** The most messages held for the station between two polls. The oldest go first. See the Discord plugin's note. */
export const MAX_HELD_MESSAGES = 200;

/** How many people's names are remembered, so a busy channel is not a `users.info` per message. */
export const MAX_KNOWN_NAMES = 500;

/** The prefix on an `InboundMessage.id` that stands for a command or a press rather than a message. */
export const INTERACTION_ID_PREFIX = 'interaction:';

/** What a failed call said. */
interface Refusal {
    /** The HTTP status, when there was one. */
    status?: number;
    /** Slack's own error code (`channel_not_found`), when it gave one. */
    error?: string;
    /** Whether sending again could work. */
    retryable: boolean;
    description: string;
}

/** Where a command or a press is answered, by the id `receive` handed out for it. */
interface HeldResponse {
    url: string;
    uses: number;
    heldAt: number;
}

/**
 * The station on Slack.
 *
 * ## Over Socket Mode, because Slack pushes
 *
 * Slash commands and button presses reach an app only at a public request URL or over Socket Mode,
 * a WebSocket the app holds open, and a plugin has no public URL. So the plugin holds one through
 * `host.socket`, driven by ServerKit's `SocketModeClient` (which acknowledges every envelope before
 * anything else, and reconnects when Slack asks it to), and queues what it hears; `receive` is the
 * host draining that queue, waiting on it when it is empty. See `plugins/discord`, which has the same
 * shape, for why the session starts on the first poll and why nothing is stored.
 *
 * ## Answered through `response_url` where there is one
 *
 * A slash command and a button press each carry a `response_url`, good for thirty minutes and five
 * replies, which answers in the channel whether or not the app was ever invited to it. It is held
 * against the id `receive` hands out, and a `send` replying to that id uses it. Everything else goes
 * through `chat.postMessage`, threaded under the message in a channel.
 *
 * ## No retries of its own
 *
 * The Web API client is built with `retries: 0` and rejects a rate-limited call. Its default is ten
 * retries over half an hour in the background, which outlives the host's deadline and the job
 * queue's own retry both, and would post a "now playing" long after the record ended.
 *
 * ## The host is captured before the first await
 *
 * As in `plugins/discord`: Socket Mode calls back from the socket's own events, long after any call
 * into the plugin.
 */
export class SlackPlugin extends Plugin implements MessagingPluginInstance {
    private botToken = '';
    private appToken = '';
    private policy: ChannelPolicy = { directMessages: true, channels: new Set() };
    private announceChannels: string[] = [];

    private socketMode?: SocketModeClient;
    /** Why Socket Mode stopped for good, until a config save starts again from scratch. */
    private fatal?: { message: string; code: PluginErrorCode };

    private readonly inbox: InboundMessage[] = [];
    private wake?: () => void;
    private overflowed = false;
    private readonly responses = new Map<string, HeldResponse>();
    /** Each message's thread, so a reply to a message inside one stays inside it. */
    private readonly threads = new Map<string, string>();
    /** The lookup rather than its answer, so two messages from one person at once ask Slack once. */
    private readonly names = new Map<string, Promise<string | undefined>>();
    private readonly unlistedChannels = new Set<string>();

    protected async onLoad(): Promise<void> {
        const config = await this.host.config.get();

        this.botToken = (await this.host.secrets.get('botToken'))?.trim() ?? '';
        this.appToken = (await this.host.secrets.get('appToken'))?.trim() ?? '';
        this.policy = {
            directMessages: configFlag(config.directMessages, true),
            channels: new Set(configLines(config.channels)),
        };
        this.announceChannels = configLines(config.announceChannels);

        this.register(() => {
            this.socketMode?.stop();
            this.socketMode = undefined;
            this.wake?.();
            this.inbox.length = 0;
            this.responses.clear();
            this.threads.clear();
            this.names.clear();
            this.unlistedChannels.clear();
        });

        this.host.logger.info('slack ready', {
            configured: this.botToken !== '' && this.appToken !== '',
            directMessages: this.policy.directMessages,
            channels: this.policy.channels.size,
            announcing: this.announceChannels.length,
        });
    }

    protected async onUnload(): Promise<void> {
        this.botToken = '';
        this.appToken = '';
    }

    /** Only with both tokens: the bot token sends, and the app token is what opens Socket Mode. */
    async accepting(): Promise<boolean> {
        return this.botToken !== '' && this.appToken !== '';
    }

    async announceTargets(): Promise<MessagingAnnounceTarget[]> {
        return this.announceChannels.map(chatId => ({ chatId, announcements: ['nowPlaying'] }));
    }

    async testConnection(): Promise<PluginConnectionResult> {
        const host = this.host;
        if (this.botToken === '') return { ok: false, message: 'No bot token set.' };
        if (this.appToken === '') return { ok: false, message: 'No app-level token set.' };
        if (this.fatal !== undefined) return { ok: false, message: this.fatal.message };

        const client = this.client(host);
        try {
            const who = (await client.web.auth.test()) as { user?: unknown; team?: unknown };
            await client.openSocketModeUrl();
            const name = typeof who.user === 'string' ? who.user : 'the app';
            const team = typeof who.team === 'string' ? ` in ${who.team}` : '';
            return { ok: true, message: `Connected as ${name}${team}.` };
        } catch (error) {
            return { ok: false, message: this.explain(this.refusal(error)) };
        }
    }

    async receive(query: MessagingReceiveQuery): Promise<MessagingReceiveResult> {
        const host = this.host;
        if (this.botToken === '' || this.appToken === '') throw new PluginError('Both tokens are needed.').withCode('config');
        if (this.fatal !== undefined) throw new PluginError(this.fatal.message).withCode(this.fatal.code);

        await this.connect(host);

        if (this.inbox.length === 0 && query.waitMs > 0) await this.waitForMessages(query.waitMs);
        return { messages: this.inbox.splice(0) };
    }

    async send(message: OutboundMessage): Promise<MessagingSendResult> {
        const host = this.host;
        if (this.botToken === '') return { delivered: false, reason: 'no bot token set', retryable: false };

        const text = escapeSlack(clip(message.text, MAX_MESSAGE_LENGTH));
        const buttons = message.buttons === undefined || message.buttons.length === 0 ? undefined : actionsBlock(message.buttons);
        if (buttons !== undefined && buttons.dropped > 0)
            host.logger.warn('slack: left off buttons Slack would not take', { dropped: buttons.dropped });
        // `plain_text` for the words beside buttons, so nothing in them is read as formatting.
        const blocks =
            buttons?.block === undefined
                ? undefined
                : [{ type: 'section', text: { type: 'plain_text', text: clip(message.text, MAX_MESSAGE_LENGTH) } }, buttons.block];

        const client = this.client(host);
        try {
            const held = this.heldResponse(message.replyToId);
            if (held !== undefined) {
                held.uses += 1;
                await client.postWebhook(
                    { text, ...(blocks === undefined ? {} : { blocks }), response_type: 'in_channel', replace_original: false },
                    held.url,
                );
                return { delivered: true };
            }

            const inThread =
                message.replyToId !== undefined && !message.replyToId.startsWith(INTERACTION_ID_PREFIX) && !isDirectChannel(message.chatId)
                    ? (this.threads.get(message.replyToId) ?? message.replyToId)
                    : undefined;
            await client.postMessage({
                channel: message.chatId,
                text,
                mrkdwn: false,
                unfurl_links: false,
                unfurl_media: false,
                ...(blocks === undefined ? {} : { blocks }),
                ...(inThread === undefined ? {} : { thread_ts: inThread }),
            });
            return { delivered: true };
        } catch (error) {
            const refusal = this.refusal(error);
            return { delivered: false, reason: this.explain(refusal), retryable: refusal.retryable };
        }
    }

    /** Opens Socket Mode if it is not open. Throws what the first connect threw, as the poll's failure. */
    private async connect(host: PluginHost): Promise<void> {
        if (this.socketMode !== undefined) return;

        const client = this.client(host);
        const socketMode = new SocketModeClient({
            openUrl: () => client.openSocketModeUrl(),
            connect: url => host.socket(url),
            handlers: {
                onEventsApi: payload => this.onEvent(host, client, payload),
                onSlashCommand: payload => this.onSlashCommand(host, client, payload),
                onInteractive: payload => this.onInteractive(host, client, payload),
            },
            logger: serverkitLogger(host),
            onError: error => {
                this.fatal = {
                    message:
                        'Slack turned off Socket Mode for this app. Turn it back on under Socket Mode in the app’s settings, then save here again.',
                    code: 'config',
                };
                host.logger.error('slack: Socket Mode stopped for good', { reason: error.message });
                this.socketMode = undefined;
                this.wake?.();
            },
        });
        this.socketMode = socketMode;

        try {
            await socketMode.start();
        } catch (error) {
            this.socketMode = undefined;
            if (error instanceof PluginError) throw error;
            const refusal = this.refusal(error);
            throw new PluginError(this.explain(refusal)).withCode(codeFor(refusal));
        }
    }

    /** A message somebody wrote. Everything else the Events API sends is ignored. */
    private async onEvent(host: PluginHost, client: SlackClient, payload: SlackEventCallback): Promise<void> {
        const event = payload.event as SlackMessageEvent;
        if (!isPersonTalking(event)) return;

        const chat = allowedChannel(event.channel, this.policy);
        if (chat === undefined) {
            this.noteUnlistedChannel(host, event.channel);
            return;
        }

        const ts = event.ts as string;
        if (event.thread_ts !== undefined) this.remember(this.threads, ts, event.thread_ts);
        this.deliver(host, {
            id: ts,
            chatId: chat.chatId,
            chatKind: chat.chatKind,
            sender: { id: event.user as string, displayName: await this.nameOf(host, client, event.user as string) },
            text: unescapeSlack(event.text as string),
            sentAt: tsToIso(ts),
        });
    }

    /**
     * A slash command, as the text it stands for. One from a channel the station does not answer in
     * is turned away with a line only its sender sees, since Slack otherwise shows them nothing at all.
     */
    private async onSlashCommand(host: PluginHost, client: SlackClient, payload: SlackCommandPayload): Promise<void> {
        const chat = allowedChannel(payload.channel_id, this.policy);
        if (chat === undefined) {
            this.noteUnlistedChannel(host, payload.channel_id);
            await client
                .postWebhook({ text: 'The station is not listening in this channel.', response_type: 'ephemeral' }, payload.response_url)
                .catch((error: unknown) => host.logger.debug('slack: could not turn away a command', { reason: this.refusal(error).description }));
            return;
        }

        const id = `${INTERACTION_ID_PREFIX}${payload.trigger_id}`;
        this.hold(id, payload.response_url);
        const args = unescapeSlack(payload.text ?? '').trim();
        this.deliver(host, {
            id,
            chatId: chat.chatId,
            chatKind: chat.chatKind,
            sender: { id: payload.user_id, displayName: await this.nameOf(host, client, payload.user_id, payload.user_name) },
            text: args === '' ? payload.command : `${payload.command} ${args}`,
            sentAt: new Date().toISOString(),
        });
    }

    /** A button pressed on one of the station's messages. */
    private async onInteractive(host: PluginHost, client: SlackClient, payload: SlackInteractionPayload): Promise<void> {
        if (payload.type !== 'block_actions') return;
        const action = payload.actions?.[0];
        const channelId = (payload.channel as { id?: unknown } | undefined)?.id;
        if (action === undefined || payload.user === undefined || typeof channelId !== 'string') return;

        const chat = allowedChannel(channelId, this.policy);
        if (chat === undefined) return;

        const id = `${INTERACTION_ID_PREFIX}${payload.trigger_id ?? `${channelId}.${Date.now()}`}`;
        if (typeof payload.response_url === 'string') this.hold(id, payload.response_url);
        const username = (payload.user as { username?: unknown }).username;
        this.deliver(host, {
            id,
            chatId: chat.chatId,
            chatKind: chat.chatKind,
            sender: {
                id: payload.user.id,
                displayName: await this.nameOf(host, client, payload.user.id, typeof username === 'string' ? username : payload.user.name),
            },
            text: '',
            action: decodeAction(action.action_id, action.value),
            sentAt: new Date().toISOString(),
        });
    }

    /**
     * What to call somebody: their display name in the workspace, read once and remembered.
     *
     * The Events API carries only a user id, and a request is announced by name. A failure is not
     * worth the message, so it falls back to the handle a command carries, or "someone".
     */
    private async nameOf(host: PluginHost, client: SlackClient, userId: string, fallback?: string): Promise<string> {
        let lookup = this.names.get(userId);
        if (lookup === undefined) {
            lookup = this.lookUpName(host, client, userId);
            this.remember(this.names, userId, lookup);
        }
        const name = await lookup;
        if (name !== undefined) return name;
        // Not remembered, so the next message asks again: a failure is usually a moment's.
        if (this.names.get(userId) === lookup) this.names.delete(userId);
        return fallback !== undefined && fallback.trim() !== '' ? fallback.trim() : 'someone';
    }

    private async lookUpName(host: PluginHost, client: SlackClient, userId: string): Promise<string | undefined> {
        try {
            const answer = (await client.web.users.info({ user: userId })) as {
                user?: { name?: string; real_name?: string; profile?: { display_name?: string; real_name?: string } };
            };
            const user = answer.user;
            return [user?.profile?.display_name, user?.profile?.real_name, user?.real_name, user?.name]
                .find((candidate): candidate is string => typeof candidate === 'string' && candidate.trim() !== '')
                ?.trim();
        } catch (error) {
            host.logger.debug('slack: could not look up a name', { reason: this.refusal(error).description });
            return undefined;
        }
    }

    private hold(id: string, url: string): void {
        const now = Date.now();
        for (const [key, held] of this.responses) if (now - held.heldAt > RESPONSE_URL_MS) this.responses.delete(key);
        this.responses.set(id, { url, uses: 0, heldAt: now });
    }

    /** The held `response_url` a reply is to, if it is young enough and has uses left. */
    private heldResponse(replyToId: string | undefined): HeldResponse | undefined {
        if (replyToId === undefined || !replyToId.startsWith(INTERACTION_ID_PREFIX)) return undefined;
        const held = this.responses.get(replyToId);
        if (held === undefined || Date.now() - held.heldAt > RESPONSE_URL_MS || held.uses >= RESPONSE_URL_USES) return undefined;
        return held;
    }

    /** A bounded map's set: the oldest entry goes once it is full. */
    private remember<T>(map: Map<string, T>, key: string, value: T): void {
        map.set(key, value);
        if (map.size > MAX_KNOWN_NAMES) map.delete(map.keys().next().value as string);
    }

    private deliver(host: PluginHost, message: InboundMessage): void {
        this.inbox.push(message);
        if (this.inbox.length > MAX_HELD_MESSAGES) {
            this.inbox.shift();
            if (!this.overflowed) host.logger.warn('slack: messages arrived faster than the station read them; dropping the oldest');
            this.overflowed = true;
        }
        this.wake?.();
    }

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

    /** A Web API client for one call, speaking through the host's fetch, with no retries of its own. */
    private client(host: PluginHost): SlackClient {
        const config: SlackConfig = {
            botToken: this.botToken,
            appToken: this.appToken,
            apiBaseUrl: `https://${SLACK_API_HOST}/api/`,
            requestTimeoutMs: REQUEST_TIMEOUT_MS,
            retries: 0,
            rejectRateLimitedCalls: true,
            fetch: (url, init) =>
                host.fetch(String(url), {
                    method: (init?.method ?? 'POST') as HostFetchMethod,
                    ...(init?.headers === undefined ? {} : { headers: init.headers }),
                    ...(typeof init?.body === 'string' ? { body: init.body } : {}),
                    ...(init?.signal === undefined ? {} : { signal: init.signal }),
                    timeoutMs: Math.min(REQUEST_TIMEOUT_MS, host.remainingMs()),
                }),
        };
        return new SlackClient(config, serverkitLogger(host));
    }

    /** What went wrong, from the Web API client, a `SlackError`, or anything else, with both tokens scrubbed. */
    private refusal(error: unknown): Refusal {
        const coded = error as { code?: unknown; data?: { error?: unknown }; statusCode?: unknown; message?: unknown };
        if (coded.code === 'slack_webapi_platform_error') {
            const slackError = typeof coded.data?.error === 'string' ? coded.data.error : 'unknown_error';
            return { error: slackError, retryable: slackError === 'ratelimited' || slackError === 'internal_error', description: slackError };
        }
        if (coded.code === 'slack_webapi_rate_limited_error') return { status: 429, retryable: true, description: 'rate limited' };
        if (coded.code === 'slack_webapi_http_error' && typeof coded.statusCode === 'number') {
            return { status: coded.statusCode, retryable: coded.statusCode >= 500, description: `HTTP ${coded.statusCode}` };
        }
        if (IsSlackError(error)) {
            const details = (error.internalDetails ?? {}) as { status?: unknown; error?: unknown; reason?: unknown };
            const status = typeof details.status === 'number' ? details.status : undefined;
            const slackError = typeof details.error === 'string' ? details.error : undefined;
            const described = slackError ?? (typeof details.reason === 'string' ? details.reason : error.message);
            return {
                ...(status === undefined ? {} : { status }),
                ...(slackError === undefined ? {} : { error: slackError }),
                retryable: status === undefined ? slackError === undefined : status === 429 || status >= 500,
                description: this.scrub(described),
            };
        }
        const message = error instanceof Error ? error.message : String(error);
        return { retryable: true, description: this.scrub(message) };
    }

    /** A refusal in words an operator can act on. */
    private explain(refusal: Refusal): string {
        if (refusal.error !== undefined && AUTH_ERRORS.has(refusal.error)) return `Slack did not accept the token (${refusal.error}).`;
        if (refusal.error === 'not_in_channel') return 'The app is not in that channel. Invite it there first.';
        if (refusal.error !== undefined) return `Slack refused: ${refusal.error}`;
        if (refusal.status === undefined) return `Could not reach Slack: ${refusal.description}`;
        return `Slack refused: ${refusal.description}`;
    }

    /** `text` with both tokens replaced, for the last line of defence before anything leaves this file. */
    private scrub(text: string): string {
        let scrubbed = text;
        for (const token of [this.botToken, this.appToken]) if (token !== '') scrubbed = scrubbed.split(token).join('<token>');
        return scrubbed;
    }

    /** Log a channel's id the first time somebody there speaks, so the operator can add it to the list. */
    private noteUnlistedChannel(host: PluginHost, channelId: string | undefined): void {
        if (channelId === undefined || isDirectChannel(channelId)) return;
        if (this.policy.channels.has(channelId) || this.unlistedChannels.has(channelId)) return;

        this.unlistedChannels.add(channelId);
        host.logger.info('slack: a channel that is not on the list spoke; add its id to answer there', { channelId });
    }
}

/** The host's vocabulary for a refused poll: the token, a rate limit, or anything else upstream. */
function codeFor(refusal: Refusal): PluginErrorCode {
    if (refusal.error !== undefined && AUTH_ERRORS.has(refusal.error)) return 'auth';
    if (refusal.status === 429) return 'rate_limited';
    if (refusal.error !== undefined) return 'config';
    return refusal.status === undefined ? 'unavailable' : 'upstream';
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
