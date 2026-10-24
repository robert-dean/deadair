import { isIP } from 'node:net';
import { connect as connectTls } from 'node:tls';
import { Container, Injectable } from 'injectkit';
import { RateLimiterMemory, RateLimiterQueue, RateLimiterQueueError } from 'rate-limiter-flexible';
import { PluginError, isPluginError } from '@deadair/plugin-sdk';
import type {
    DiscoveredService,
    DiscoveryOptions,
    DiscoveryQuery,
    HostFetchInit,
    HostFetchMethod,
    PluginConfigAccess,
    PluginEvents,
    PluginHost,
    PluginLogger,
    PluginManifest,
    PluginOAuth,
    PluginSecrets,
    PluginSocket,
    PluginSocketOptions,
    PluginStorage,
    PluginTlsOptions,
    PluginTlsSocket,
    PluginTrackFetcher,
    ProviderTrack,
} from '@deadair/plugin-sdk';
import { SpotifyShimClient, type FetchedPlaylistTrack } from '#modules/stream/spotify.shim.client.js';
import { ApplePlayerClient } from '#modules/stream/apple.player.client.js';
import { PluginAirState } from './plugin.air.state.js';
import { PluginConfigService } from './plugin.config.service.js';
import { DISCOVERY_DEFAULT_TIMEOUT_MS, DISCOVERY_MAX_TIMEOUT_MS, SystemDiscoverer, type NetworkDiscoverer } from './plugin.discovery.js';
import { invocationRemainingMs, invocationSignal } from './plugin.invocation.deadline.js';
import { PLUGIN_INVOKE_TIMEOUT_MS } from './plugin.invoker.js';
import { PluginLog } from './plugin.log.js';
import { isPrivateAddress, NETWORK_OPEN, privateAddressBehind, resolveAddresses as systemResolver, type AddressResolver } from './plugin.grants.js';
import { PluginGrantsService } from './plugin.grants.service.js';
import { OAUTH_SECRET_FIELD, PLUGIN_OAUTH_SECRET_KEY } from './plugin.oauth.secret.js';
import { PluginStorageRepository } from './plugin.storage.repository.js';
import { causeText, errorText } from '#modules/shared/error.text.js';
import { inScope } from '#modules/shared/scoped.work.js';
import { REDIRECT_STATUSES } from '#modules/shared/redirect.hops.js';
import { type NetworkEntry, needsConfig, normalizeNetwork, matchesHost } from './plugin.network.settings.js';
import {
    type BodyRelease,
    egressController,
    type SentResponse,
    guardedResponse,
    PLUGIN_RESPONSE_MAX_BYTES,
    cancelBody,
    parseRetryAfter,
    withUserAgent,
    withoutHeaders,
    BODY_HEADERS,
    CREDENTIAL_HEADERS,
} from './plugin.egress.guard.js';

export { PLUGIN_OAUTH_SECRET_KEY, OAUTH_SECRET_FIELD } from './plugin.oauth.secret.js';

/** Requests one plugin may start per {@link PLUGIN_FETCH_WINDOW_SECONDS} before `host.fetch` paces it. */
export const PLUGIN_FETCH_REQUESTS_PER_WINDOW = 10;
export const PLUGIN_FETCH_WINDOW_SECONDS = 1;

/**
 * The wall-clock budget for one `host.fetch`, used when the plugin does not ask
 * for its own. Everything the call does spends from it: waiting for rate-limit
 * headroom, the request itself, a `Retry-After` back-off, and the retry.
 *
 * A plugin may ask for less, or for more up to whatever the invocation it is
 * running inside has left ({@link PLUGIN_INVOKE_TIMEOUT_MS} when there is no
 * invocation to ask). That ceiling is not arbitrary: the call into plugin code
 * is already abandoned by `PluginInvoker` at that deadline, so a fetch budget
 * above it describes time the plugin will never be given.
 *
 * Strictly under {@link PLUGIN_INVOKE_TIMEOUT_MS} rather than equal to it, because this budget is
 * supposed to cover a `Retry-After` back-off and the retry as well as the request itself, and a
 * default that spends the entire invocation on the first attempt leaves nothing for the second one
 * it is meant to include. The two moved together when the invoke default came down under the pool's
 * acquire timeout; the ratio between them is what was kept.
 */
export const PLUGIN_FETCH_TIMEOUT_MS = 6_000;

/**
 * How many server-directed hops a single `host.fetch` will follow before giving
 * up. Redirects are not charged against the plugin's rate limit, so this cap is
 * the only thing bounding a redirect loop.
 */
export const MAX_PLUGIN_FETCH_REDIRECTS = 5;

/**
 * The longest `host.socket` waits for a socket to open. Plugins may ask for less.
 *
 * Not the invocation's deadline, because a socket is usually opened from a plugin's own background
 * start rather than inside a call the host is waiting on, and when it is inside one the plugin is
 * choosing to spend that call's time.
 */
export const PLUGIN_SOCKET_CONNECT_TIMEOUT_MS = 10_000;

/**
 * The most one inbound text frame may carry before the socket is closed.
 *
 * Sized above the largest frame either chat platform sends a bot in one ordinary server: Discord's
 * `GUILD_CREATE` lists every channel and role, and is the frame that grows with the server. A frame
 * over it is closed on rather than truncated, for the body guard's reason: bytes a plugin gets are
 * bytes the server sent.
 */
export const PLUGIN_SOCKET_MAX_FRAME_BYTES = 4 * 1024 * 1024;

/**
 * How many sockets one plugin may hold open at once.
 *
 * A platform connection is one socket and a reconnect briefly two; this is room for that and a
 * mistake, not for a plugin that opens one per chat.
 */
export const PLUGIN_SOCKET_MAX_OPEN = 4;

/**
 * The part of the platform `WebSocket` the host drives, so tests can hand it a double.
 *
 * `addEventListener` only, with the four events a client socket has, and text frames: a binary frame
 * is dropped before a plugin sees it.
 */
export interface HostWebSocket {
    send(data: string): void;
    close(code?: number, reason?: string): void;
    addEventListener(
        type: 'open' | 'message' | 'close' | 'error',
        listener: (event: { data?: unknown; code?: number; reason?: string }) => void,
    ): void;
}

/** Opens a {@link HostWebSocket}. The platform's own unless a test says otherwise. */
export type HostWebSocketOpener = (url: string) => HostWebSocket;

const platformWebSocket: HostWebSocketOpener = url => new WebSocket(url) as unknown as HostWebSocket;

/**
 * How many `host.tls` connections one plugin may hold open at once.
 *
 * Counted apart from {@link PLUGIN_SOCKET_MAX_OPEN} and higher, because the shape differs: a chat
 * platform is one socket, while a plugin driving speakers holds one per device it is playing on. This
 * is a room's worth and a reconnect, not a building's.
 */
export const PLUGIN_TLS_MAX_OPEN = 16;

/**
 * The part of a `node:tls` connection the host drives, so tests can hand it a double.
 *
 * Events rather than a stream interface: the host only ever reads `data`, and the four events are the
 * whole of what it reacts to.
 */
export interface HostTlsConnection {
    write(bytes: Uint8Array): void;
    destroy(): void;
    on(event: 'secureConnect' | 'close', listener: () => void): void;
    on(event: 'data', listener: (bytes: Uint8Array) => void): void;
    on(event: 'error', listener: (error: Error) => void): void;
}

/** What {@link HostTlsOpener} is asked to connect to, once the URL has passed the policy. */
export interface HostTlsTarget {
    host: string;
    port: number;
    /** Whether the certificate must chain and name the host. */
    verifyCertificate: boolean;
}

/** Opens a {@link HostTlsConnection}. `node:tls` unless a test says otherwise. */
export type HostTlsOpener = (target: HostTlsTarget) => HostTlsConnection;

const platformTls: HostTlsOpener = ({ host, port, verifyCertificate }) =>
    connectTls({
        host,
        port,
        rejectUnauthorized: verifyCertificate,
        // SNI is for names; sending an address as one is a protocol error some servers answer.
        ...(isIP(host) === 0 ? { servername: host } : {}),
    }) as unknown as HostTlsConnection;

/**
 * Where the host's own OAuth redirect endpoint lives. Constructor-injected
 * exactly like the loader's options so the factory never touches `AppConfig`.
 */
@Injectable()
export class PluginHostFactoryOptions {
    constructor(
        readonly baseUrl: string,
        /**
         * How a hostname off the allowlist is turned into the addresses it reaches, for the private-
         * address check behind the `network.open` grant. The system resolver unless a test says
         * otherwise; see {@link privateAddressBehind}.
         */
        readonly resolveAddresses: AddressResolver = systemResolver,
        /** How `host.socket` opens a WebSocket once the URL has passed the policy. */
        readonly openWebSocket: HostWebSocketOpener = platformWebSocket,
        /** How `host.tls` opens a connection once the URL has passed the policy. */
        readonly openTls: HostTlsOpener = platformTls,
        /** How `host.discover` looks for devices. One per process, since it owns the multicast sockets. */
        readonly discoverer: NetworkDiscoverer = new SystemDiscoverer(),
    ) {}
}

/**
 * One plugin instance's open sockets, and whether it may open more.
 *
 * `closed` is set when the plugin is disposed, and is what stops a client that was never stopped
 * from reconnecting through a host whose plugin is gone.
 */
interface SocketRegistry {
    closed: boolean;
    /** Each open socket's way of being closed by the host. */
    sockets: Set<() => void>;
    /** The same for each `host.tls` connection, counted apart because its cap is. */
    tls: Set<() => void>;
}

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

/**
 * How many calls may be waiting on one bucket before the next is refused outright.
 *
 * A queue is a promise to serve everyone eventually, and without a cap that promise outlives any
 * upstream worth making it to: a plugin bursting against a one-per-second limit would accumulate
 * waiters faster than they drain and each would sit there until its own deadline expired. Well
 * above what the station's own subsystems can produce at once, so it only ever catches a runaway.
 */
const MAX_RATE_LIMIT_QUEUE = 200;

/**
 * One upstream's pacing: the limiter that counts, and the FIFO queue that waits on it.
 *
 * Paired rather than kept apart because both are needed per call — the queue admits the waiters in
 * order, and the limiter is what can still say how long a refusal should back off for, which the
 * queue's own error does not carry.
 */
interface RateBucket {
    limiter: RateLimiterMemory;
    queue: RateLimiterQueue;
}

/**
 * The limiter shape for a declared rate, capped at the host's ceiling: a plugin
 * may ask to be paced more slowly than the host would, never faster.
 *
 * Under one request per second there are no fractional points to hand out, so
 * the window stretches instead of the allowance shrinking: one request per
 * `ceil(1 / rate)` seconds. Rounding the window up rather than down keeps the
 * effective rate at or under what was asked for, which is the direction that
 * cannot get a station blocked.
 */
const limiterFor = (ratePerSecond: number | undefined): RateLimiterMemory => {
    if (ratePerSecond === undefined) {
        return new RateLimiterMemory({ points: PLUGIN_FETCH_REQUESTS_PER_WINDOW, duration: PLUGIN_FETCH_WINDOW_SECONDS });
    }

    const capped = Math.min(ratePerSecond, PLUGIN_FETCH_REQUESTS_PER_WINDOW / PLUGIN_FETCH_WINDOW_SECONDS);
    if (capped >= 1) return new RateLimiterMemory({ points: Math.floor(capped), duration: 1 });
    return new RateLimiterMemory({ points: 1, duration: Math.ceil(1 / capped) });
};

/**
 * Builds the one object a plugin is allowed to touch the outside world through.
 *
 * Everything a plugin could otherwise reach directly (the network, the database,
 * the environment, the encryption key) is behind a method here, and every method
 * is gated on the manifest permission that covers it. So a plugin that goes
 * through its `PluginHost` does exactly what its manifest declared, which is
 * what makes the manifest an honest description of a well-behaved plugin's
 * blast radius.
 *
 * It is not what stops a badly-behaved one, and it never will be. `PluginLoader` imports plugin code
 * into this process with a plain dynamic `import()`, permanently (`packages/plugin-sdk/CLAUDE.md` §
 * "Trust and egress"), so a plugin that wants global `fetch`, `fs`, or `process.env` has them and
 * gating the methods here does not take them away. This is the reliability and disclosure layer,
 * which is all it was ever actually doing.
 *
 * So what crosses back to a plugin is whatever suits the job: `host.fetch`
 * hands over a real `Response` and `host.signal` a real `AbortSignal`. The
 * JSON-safe rule still governs the payloads that are stored or sent, which is
 * most of `capabilities/`, and `boundary.json.safe.ts` still fails `tsc` over
 * those.
 *
 * Failures included. Everything thrown from here is thrown INTO plugin code,
 * so it is a `PluginError` and never a `ServerkitError`: the SDK deliberately
 * does not depend on the server's error framework (see the note atop
 * `plugin.error.ts`), and a plugin catching its own fetch rejection should be
 * branching on `error.code`, not pattern-matching a framework class it should
 * never have been handed. The status each code answers with lives in
 * `plugin.error.http.ts`, which is also what makes it reach the client:
 * `PluginInvoker` funnels every throw through `toPluginError`, and anything
 * that is not already a `PluginError` lands on `internal` and flattens to 500.
 */
@Injectable()
export class PluginHostFactory {
    /**
     * Every response body any plugin still has open, by plugin id.
     *
     * Here rather than only in the closure `createHost` builds, because somebody
     * outside the host has to be able to let go of these: a plugin is disposed by
     * `PluginLifecycleManager`, which holds the record and not the host object.
     * See {@link cancelOpenBodies}.
     */
    private readonly openBodies = new Map<string, Set<BodyRelease>>();

    /** Every socket any plugin still has open, by plugin id, for {@link closeOpenSockets}'s reason. */
    private readonly openSockets = new Map<string, SocketRegistry>();

    /**
     * The (plugin, hostname) pairs already reported as reached off the
     * allowlist.
     *
     * The bypass is an operator's decision and the log line is what keeps it
     * visible, but a bulletin reading four articles an hour would otherwise
     * write the same sentence about the same publisher forever. Once per pair,
     * per process.
     */
    private readonly auditedBypasses = new Set<string>();

    /** What backs every `host.air`. See {@link PluginAirState}. */
    private readonly air: PluginAirState;

    constructor(
        private readonly options: PluginHostFactoryOptions,
        private readonly container: Container,
        private readonly pluginLog: PluginLog,
        private readonly spotifyShimClient: SpotifyShimClient,
        private readonly applePlayerClient: ApplePlayerClient,
        private readonly grants: PluginGrantsService,
        // Optional only so a test about some other part of the host need not build one: absent is a
        // station that never goes on air, which is what `host.air` reads before the first pass anyway.
        air?: PluginAirState,
    ) {
        this.air = air ?? new PluginAirState();
    }

    // `PluginConfigService` and `PluginStorageRepository` are scoped, so every capability call
    // below opens its own scope (see `#modules/shared/scoped.work.js`). InjectKit's rejection of
    // a captured scoped instance at `build()` is how that used to surface: before the check, it
    // was `Transaction is already committed` thrown into whichever plugin happened to read its
    // own config.

    /** One host per plugin. Cheap: the only per-host state is its rate buckets. */
    createHost(manifest: PluginManifest): PluginHost {
        const logger = this.pluginLog.for(manifest.id);
        const entries = this.networkEntries(manifest, logger);
        // Per bucket, not per plugin: a plugin talking to two upstreams was
        // sharing one allowance between them, which paced it against a limit
        // neither of them published. Built lazily, so a declared-but-unused
        // upstream costs nothing.
        const buckets = new Map<string, RateBucket>();

        // Per plugin instance, and the reason `cancelOpenBodies` exists: a body
        // outlives the invocation that fetched it, so nothing else would ever
        // release one belonging to a plugin that is being disposed.
        const bodies = new Set<BodyRelease>();
        this.openBodies.set(manifest.id, bodies);

        // Per instance for the same reason, and marked closed rather than dropped on dispose, so a
        // socket asked for through a host that outlived its plugin is refused.
        const sockets: SocketRegistry = { closed: false, sockets: new Set(), tls: new Set() };
        this.openSockets.set(manifest.id, sockets);

        // What `host.discover` has found for this plugin, which it may then reach as though the
        // operator had typed it in. Per instance, so a config save starts the plugin over from what
        // it was told rather than from everything it ever saw.
        const found = new Set<string>();
        const declared = entries;
        const reachable = async (): Promise<NetworkEntry[]> => [
            ...(await declared()),
            ...[...found].map((hostname): NetworkEntry => ({ pattern: hostname, bucket: hostname, operator: true })),
        ];

        return {
            logger,
            fetch: (url, init) => this.hostFetch(manifest, reachable, buckets, logger, bodies, url, init),
            socket: (url, options) => this.hostSocket(manifest, reachable, buckets, logger, sockets, url, options),
            tls: (url, options) => this.hostTls(manifest, reachable, buckets, logger, sockets, url, options),
            discover: (query, options) => this.hostDiscover(manifest, found, query, options),
            // A getter, not a captured value: the host object outlives every
            // invocation made through it, so it has to read the ambient one at
            // the moment the plugin asks rather than whichever was running when
            // `createHost` was called.
            get signal() {
                return invocationSignal();
            },
            // Never negative: a plugin reading this is deciding whether to
            // start more work, and "-40" and "0" are the same answer to that
            // question. `hostFetch` reads the raw value instead, because it
            // does need to tell "expired" apart from "expiring".
            remainingMs: () => Math.max(0, invocationRemainingMs() ?? PLUGIN_INVOKE_TIMEOUT_MS),
            storage: this.createStorage(manifest),
            secrets: this.createSecrets(manifest),
            config: this.createConfig(manifest),
            oauth: this.createOAuth(manifest),
            events: this.createEvents(manifest, logger),
            air: this.air.hostFor(manifest.id, logger),
            trackFetcher: this.createTrackFetcher(manifest),
        };
    }

    /**
     * The allowlist for one host, resolved at most once and then reused.
     *
     * Lazy because a `fromConfig` entry needs a database read, and doing it in
     * `createHost` would put a query in front of every plugin's initialization
     * whether or not it has one. Memoized as the promise rather than the result
     * so concurrent first calls share the one read.
     *
     * Reusing it cannot go stale: `PluginConfigService.getConfig` has no cache,
     * but every write to a plugin's config reinitializes it
     * ({@link PluginLifecycleManager.reinitPlugin}), and that builds a new host
     * with a fresh memo. A manifest with no `fromConfig` entry never reads the
     * database at all.
     */
    private networkEntries(manifest: PluginManifest, logger: PluginLogger): () => Promise<NetworkEntry[]> {
        const declared = manifest.permissions.network;
        if (!needsConfig(declared)) {
            const fixed = normalizeNetwork(declared, {});
            return async () => fixed;
        }

        let resolved: Promise<NetworkEntry[]> | undefined;
        return () => {
            resolved ??= inScope(this.container, scope => scope.get(PluginConfigService).getConfig(manifest.id)).then(config => {
                const entries = normalizeNetwork(declared, config, manifest.configFields);
                // An entry that resolved to nothing is a setting the operator
                // has not filled in (or filled in wrongly), and the symptom is
                // a `forbidden` per request naming a host they thought they had
                // configured. Say so once, here, where the cause is visible.
                if (entries.length < declared.length) {
                    logger.warn('plugin network entry could not be resolved from config', {
                        declared: declared.length,
                        resolved: entries.length,
                    });
                }
                return entries;
            });
            return resolved;
        };
    }

    private createStorage(manifest: PluginManifest): PluginStorage {
        // `internal`, not `config` or `forbidden`: the manifest is the plugin's
        // own code, so calling a capability it never declared is a bug in the
        // plugin rather than something the operator can fix or the upstream did.
        const guard = (): void => {
            if (!manifest.permissions.storage) {
                throw new PluginError(`plugin "${manifest.id}" does not declare the "storage" permission`).withCode('internal');
            }
        };

        return {
            get: async key => {
                guard();
                return inScope(this.container, scope => scope.get(PluginStorageRepository).get(manifest.id, key));
            },
            set: async (key, value) => {
                guard();
                await inScope(this.container, scope => scope.get(PluginStorageRepository).set(manifest.id, key, value));
            },
            delete: async key => {
                guard();
                await inScope(this.container, scope => scope.get(PluginStorageRepository).delete(manifest.id, key));
            },
            list: async prefix => {
                guard();
                return inScope(this.container, scope => scope.get(PluginStorageRepository).listKeys(manifest.id, prefix));
            },
        };
    }

    /**
     * The station's track fetcher, for the one provider shape that cannot ask its
     * own provider: audio, or a playlist, that is reachable only to a process
     * speaking a protocol the plugin does not.
     *
     * Wired straight to the Spotify shim rather than to a registry of fetchers,
     * because there is exactly one and inventing a lookup for it would describe a
     * generality the station does not have. The SDK's side is general because it
     * is a published contract; this side is a binary in a sibling container.
     *
     * The session the plugin hands over goes to the shim and nowhere else: it is
     * not stored, not logged, and not readable back.
     */
    private createTrackFetcher(manifest: PluginManifest): PluginTrackFetcher {
        // `internal` for the same reason as the storage guard above.
        const guard = (): void => {
            if (!manifest.permissions.trackFetcher) {
                throw new PluginError(`plugin "${manifest.id}" does not declare the "trackFetcher" permission`).withCode('internal');
            }
        };

        return {
            serve: async request => {
                guard();
                return this.spotifyShimClient.serve(request.trackId, request.session);
            },
            // The player-shaped helper, for audio that has to be performed rather than transferred.
            // A second method rather than a flag on `serve`, because the two take different things:
            // a shim is lent a login per call and a player holds its own sign-in. Gated on the same
            // `trackFetcher` permission, since it is the same disclosure — this plugin's audio comes
            // from a helper the station runs rather than from a URL it mints.
            servePlayer: async request => {
                guard();
                return this.applePlayerClient.serve(request.trackId);
            },
            playlistTracks: async request => {
                guard();
                const answer = await this.spotifyShimClient.playlistTracks(request.playlistId, { offset: request.offset, limit: request.limit });
                if (answer.ok) return answer.value.tracks.map(toProviderTrack);

                // 503 is this station having no fetcher set up, which the SDK spells `undefined` and
                // a plugin answers exactly as it did before this method existed. Anything else is
                // the fetcher having tried and failed, which is a provider failure and belongs to
                // the plugin's own error handling: `upstream` rather than `internal`, because what
                // went wrong is not the plugin's doing.
                if (answer.status === 503) return undefined;
                throw new PluginError(answer.message).withCode('upstream');
            },
        };
    }

    private createSecrets(manifest: PluginManifest): PluginSecrets {
        return {
            get: async key => {
                const secrets = await inScope(this.container, scope => scope.get(PluginConfigService).getSecrets(manifest.id));
                return secrets[key];
            },
        };
    }

    private createConfig(manifest: PluginManifest): PluginConfigAccess {
        return {
            get: async () => inScope(this.container, scope => scope.get(PluginConfigService).getConfig(manifest.id)),
        };
    }

    /**
     * The token vault. Tokens are stored as one encrypted secret under
     * {@link PLUGIN_OAUTH_SECRET_KEY}, which means they ride the same encryption
     * path as operator-entered secrets and are just as invisible to the settings
     * read model (which only ever asks about the manifest's own fields).
     */
    private createOAuth(manifest: PluginManifest): PluginOAuth {
        // `internal` for the same reason as the storage guard above.
        const guard = (): void => {
            if (!manifest.permissions.oauth) {
                throw new PluginError(`plugin "${manifest.id}" does not declare the "oauth" permission`).withCode('internal');
            }
        };

        return {
            getRedirectUri: async () => {
                guard();
                return `${this.options.baseUrl.replace(/\/+$/, '')}/plugins/${encodeURIComponent(manifest.id)}/oauth/callback`;
            },
            saveTokens: async tokens => {
                guard();
                const flat: Record<string, string> = {};
                for (const [key, value] of Object.entries(tokens ?? {})) {
                    if (typeof value !== 'string') {
                        throw new PluginError(`oauth token "${key}" must be a string`).withCode('internal');
                    }
                    flat[key] = value;
                }
                // This is the hourly token-refresh path. Nothing reinitializes
                // the plugin off this write: it is the plugin's own call, and
                // reloading it here would dispose the instance mid-refresh.
                //
                // Passing the manifest's own fields alongside the reserved one is
                // deliberate: saveConfig rebuilds the whole `config` object from
                // the descriptors it is given, so omitting them would blank the
                // plugin's operator-entered settings on every token refresh.
                await inScope(this.container, scope =>
                    scope.get(PluginConfigService).saveConfig(manifest.id, [...manifest.configFields, OAUTH_SECRET_FIELD], {
                        [PLUGIN_OAUTH_SECRET_KEY]: JSON.stringify(flat),
                    }),
                );
            },
            getTokens: async () => {
                guard();
                const secrets = await inScope(this.container, scope => scope.get(PluginConfigService).getSecrets(manifest.id));
                const raw = secrets[PLUGIN_OAUTH_SECRET_KEY];
                if (raw === undefined) return undefined;
                try {
                    const parsed: unknown = JSON.parse(raw);
                    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined;
                    const tokens: Record<string, string> = {};
                    for (const [key, value] of Object.entries(parsed)) {
                        if (typeof value === 'string') tokens[key] = value;
                    }
                    return tokens;
                } catch {
                    // Corrupt vault reads as "never authorized" rather than as a
                    // hard failure: the plugin's recovery for both is the same.
                    return undefined;
                }
            },
        };
    }

    /** Log-only for now. The seam is typed so a real bus can slot in without a plugin change. */
    private createEvents(manifest: PluginManifest, logger: PluginLogger): PluginEvents {
        return {
            emit: async (event, payload) => {
                logger.info('plugin event', { event, payload });
            },
        };
    }

    /**
     * The sanctioned network egress: the path a plugin is meant to take, and
     * the one every first-party plugin does take.
     *
     * Order matters: the allowlist check happens before anything touches the
     * network stack, so a denied request costs a DNS lookup of exactly zero and
     * leaves an audit line behind.
     *
     * The whole call runs against ONE deadline, and every part of it spends
     * from the same budget: parking for rate-limit headroom, the request, the
     * `Retry-After` back-off, the retry. Separate caps per phase is how a call
     * ends up promising a 10s timeout and taking 40s, and how a limit gets
     * written down that the invoker's own deadline means can never be reached.
     *
     * The ceiling is what the invocation this runs inside has left, not
     * `PLUGIN_INVOKE_TIMEOUT_MS`. That constant is only the invoker's default,
     * and clamping to it was wrong in both directions: a caller that asked for
     * a shorter invocation got a fetch that outlived it and was killed
     * mid-flight, and one that asked for a longer background budget could not
     * spend it. Outside any invocation (a plugin fetching from a timer of its
     * own) there is nothing to inherit, so the constant is the fallback.
     */
    private async hostFetch(
        manifest: PluginManifest,
        networkEntries: () => Promise<NetworkEntry[]>,
        buckets: Map<string, RateBucket>,
        logger: PluginLogger,
        bodies: Set<BodyRelease>,
        url: string,
        init?: HostFetchInit,
    ): Promise<Response> {
        const entries = await networkEntries();
        const { url: target, entry, open } = this.assertAllowed(manifest, entries, logger, url);
        if (open) await this.assertPublicAddress(manifest, logger, target);
        const { deadlineAt, budgetMs } = this.budgetFor(manifest, target, init);

        const { controller, dispose } = egressController(deadlineAt, init?.signal);

        let sent: SentResponse;
        try {
            sent = await this.sendWithRetry(manifest, entries, buckets, logger, entry, target, init, controller, deadlineAt, budgetMs);
        } catch (error) {
            // Nothing was registered, so nothing else will ever abort this.
            controller.abort();
            throw this.transportFailure(manifest, target.hostname.toLowerCase(), controller, budgetMs, error);
        } finally {
            // The fetch deadline is done with either way: it covered connect,
            // headers and the redirect chain, and from here the body's own
            // bounds apply. Leaving the timer armed would abort a perfectly
            // healthy body mid-read.
            dispose();
        }

        // Refused before a byte is read, when the server was honest about the
        // size. The running count in the guard is what catches a server that
        // understates the header or omits it entirely, which is exactly what one
        // streaming forever would do.
        this.assertDeclaredSizeFits(manifest, sent, controller);

        return guardedResponse(manifest, sent, controller, bodies);
    }

    /**
     * Refuses an over-cap body on its `content-length` alone.
     *
     * Cheap and early, and not sufficient on its own: a chunked response has no
     * `content-length` at all, so the guard counts as it reads. Both, because
     * either alone is wrong.
     */
    private assertDeclaredSizeFits(manifest: PluginManifest, sent: SentResponse, controller: AbortController): void {
        const declared = Number(sent.response.headers.get('content-length') ?? Number.NaN);
        if (!Number.isFinite(declared) || declared <= PLUGIN_RESPONSE_MAX_BYTES) return;

        controller.abort();
        void cancelBody(sent.response);
        throw new PluginError(
            `plugin "${manifest.id}" response body from ${sent.url.toString()} declares ${declared} bytes, over the ${PLUGIN_RESPONSE_MAX_BYTES} byte limit`,
        ).withCode('upstream');
    }

    /**
     * How long one egress call gets, and when it runs out.
     *
     * This bounds getting the RESPONSE only: connect, headers and the whole
     * redirect chain. Reading the body is bounded separately, by the guard's
     * own idle, lifetime and byte caps, which is the point. A legitimate large
     * body outlives the call that asked for it.
     *
     * @throws {PluginError} `timeout` when the invocation is already over.
     *   Issuing the request anyway would spend a round trip on a response nobody
     *   is left to receive, and report it as a transport failure when the truth
     *   is that the call was over.
     */
    private budgetFor(manifest: PluginManifest, target: URL, init: HostFetchInit | undefined): { deadlineAt: number; budgetMs: number } {
        const ceilingMs = invocationRemainingMs() ?? PLUGIN_INVOKE_TIMEOUT_MS;
        if (ceilingMs <= 0) {
            const hostname = target.hostname.toLowerCase();
            throw new PluginError(`plugin "${manifest.id}" fetch to "${hostname}" failed: the call's deadline had already passed`).withCode(
                'timeout',
            );
        }

        const budgetMs = Math.min(init?.timeoutMs ?? PLUGIN_FETCH_TIMEOUT_MS, ceilingMs);
        return { deadlineAt: Date.now() + budgetMs, budgetMs };
    }

    /**
     * The rate limit, the request chain, and one `Retry-After` back-off.
     *
     * Everything both egress paths must agree on, in one place: a stream that
     * paced itself differently from a fetch, or skipped the back-off, would be a
     * second egress policy wearing the first one's manifest.
     *
     * The retry is the server's idea, never ours — one attempt, only on a 429 or
     * 503 that named a delay. Anything more belongs to the plugin, which knows
     * whether the call is idempotent. It applies to opening a stream for the
     * same reason it applies to a fetch: a 429 is a response status and arrives
     * before any body, so there is nothing half-read to unwind. It has no
     * meaning for a `read`, where the body is already flowing.
     */
    private async sendWithRetry(
        manifest: PluginManifest,
        entries: NetworkEntry[],
        buckets: Map<string, RateBucket>,
        logger: PluginLogger,
        entry: NetworkEntry,
        target: URL,
        init: HostFetchInit | undefined,
        controller: AbortController,
        deadlineAt: number,
        budgetMs: number,
    ): Promise<SentResponse> {
        await this.consumeRateLimit(manifest, buckets, entry, deadlineAt);
        const first = await this.sendRaw(manifest, entries, logger, target, init, controller, budgetMs);

        if (first.response.status !== 429 && first.response.status !== 503) return first;
        const retryAfterMs = parseRetryAfter(first.response.headers.get('retry-after') ?? undefined, Date.now());
        // A back-off longer than what is left would be slept through only to
        // have the retry abandoned on arrival, so the first response is the
        // answer: the plugin gets the 429 and its `Retry-After` to act on.
        if (retryAfterMs === undefined || retryAfterMs >= deadlineAt - Date.now()) return first;

        const hostname = target.hostname.toLowerCase();
        logger.info('plugin fetch backing off on Retry-After', { hostname, status: first.response.status, retryAfterMs });
        // The first answer is being thrown away, so let go of its socket rather
        // than leaving a body dangling until the GC notices.
        await cancelBody(first.response);

        await sleep(retryAfterMs);
        await this.consumeRateLimit(manifest, buckets, entry, deadlineAt);
        return this.sendRaw(manifest, entries, logger, target, init, controller, budgetMs);
    }

    /**
     * Let go of every response body a plugin still holds.
     *
     * Called when a plugin is disposed, so a body cannot outlive the instance
     * that fetched it. That is a backstop for a plugin that crashed or forgot,
     * not the sanctioned way to finish with one: a well-behaved plugin reads its
     * body to the end or cancels it, and the lifetime cap catches the rest long
     * before shutdown.
     *
     * Safe to call for a plugin that never opened one, and safe to call twice.
     */
    cancelOpenBodies(pluginId: string): void {
        const bodies = this.openBodies.get(pluginId);
        this.openBodies.delete(pluginId);
        if (bodies === undefined) return;

        const disposed = new PluginError(`plugin "${pluginId}" was disposed while a response body was still open`).withCode('unavailable');
        // A copy, because releasing a body removes it from this very set.
        for (const release of [...bodies]) release(disposed);
    }

    /**
     * Closes every socket and TLS connection a plugin still has open, and refuses it any more.
     *
     * The socket twin of {@link cancelOpenBodies}, called beside it once a plugin is disposed. The
     * plugin's close listeners are NOT told: a client told its socket closed reconnects, and there
     * is nothing left to reconnect for.
     *
     * Safe to call for a plugin that never opened one, and safe to call twice.
     */
    closeOpenSockets(pluginId: string): void {
        const registry = this.openSockets.get(pluginId);
        this.openSockets.delete(pluginId);
        if (registry === undefined) return;

        registry.closed = true;
        for (const close of [...registry.sockets, ...registry.tls]) close();
    }

    /**
     * Drops every `host.air` listener a plugin still holds, called beside {@link closeOpenSockets}
     * once it is disposed, so a listener the plugin forgot cannot be told about a station it no
     * longer has a part in.
     *
     * Safe to call for a plugin that never listened, and safe to call twice.
     */
    releaseAirListeners(pluginId: string): void {
        this.air.release(pluginId);
    }

    /**
     * `host.socket`: the fetch policy applied to a WebSocket.
     *
     * The URL goes through {@link assertAllowed} as the `https:` URL it upgrades from, so the one
     * allowlist governs both, and through {@link assertPublicAddress} when it was reached through
     * `network.open`. The connect costs one token from the matching bucket. What differs from fetch
     * is time: a socket outlives the call that opened it, so it is bounded by the frame cap, the count
     * cap and disposal rather than by an invocation's deadline.
     *
     * Everything a plugin's listener throws is caught and logged here. The platform's `WebSocket`
     * dispatches from its own event loop turn, where a throw would be an uncaught exception in the
     * API server rather than a failure of the plugin.
     */
    private async hostSocket(
        manifest: PluginManifest,
        networkEntries: () => Promise<NetworkEntry[]>,
        buckets: Map<string, RateBucket>,
        logger: PluginLogger,
        registry: SocketRegistry,
        url: string,
        options: PluginSocketOptions | undefined,
    ): Promise<PluginSocket> {
        // `internal` for the storage guard's reason.
        if (!manifest.permissions.sockets) {
            throw new PluginError(`plugin "${manifest.id}" does not declare the "sockets" permission`).withCode('internal');
        }

        let upgrade: URL;
        try {
            upgrade = new URL(url);
        } catch {
            throw new PluginError(`plugin "${manifest.id}" asked for a socket to an unparseable URL`).withCode('config');
        }
        if (upgrade.protocol !== 'wss:') {
            throw new PluginError(`plugin "${manifest.id}" may only open wss: sockets, got "${upgrade.protocol}"`).withCode('config');
        }

        const refuseClosed = (): never => {
            throw new PluginError(`plugin "${manifest.id}" was disposed; it may not open a socket`).withCode('unavailable');
        };
        if (registry.closed) refuseClosed();
        if (registry.sockets.size >= PLUGIN_SOCKET_MAX_OPEN) {
            throw new PluginError(`plugin "${manifest.id}" already holds ${PLUGIN_SOCKET_MAX_OPEN} open sockets, the most it may`).withCode(
                'internal',
            );
        }

        const policed = new URL(upgrade);
        policed.protocol = 'https:';
        const entries = await networkEntries();
        const { entry, open } = this.assertAllowed(manifest, entries, logger, policed.toString());
        if (open) await this.assertPublicAddress(manifest, logger, policed);

        const timeoutMs = Math.min(options?.connectTimeoutMs ?? PLUGIN_SOCKET_CONNECT_TIMEOUT_MS, PLUGIN_SOCKET_CONNECT_TIMEOUT_MS);
        const deadlineAt = Date.now() + timeoutMs;
        await this.consumeRateLimit(manifest, buckets, entry, deadlineAt);
        if (registry.closed) refuseClosed();

        const hostname = upgrade.hostname.toLowerCase();
        let raw: HostWebSocket;
        try {
            raw = this.options.openWebSocket(upgrade.toString());
        } catch (error) {
            throw new PluginError(`plugin "${manifest.id}" could not open a socket to "${hostname}": ${errorText(error)}`).withCode('upstream');
        }

        return new Promise<PluginSocket>((resolve, reject) => {
            const messageListeners: ((text: string) => void)[] = [];
            const closeListeners: ((code?: number, reason?: string) => void)[] = [];
            let state: 'connecting' | 'open' | 'closed' = 'connecting';
            let closedWith: { code?: number; reason?: string } | undefined;
            let muted = false;

            const safely = (what: string, fn: () => void): void => {
                try {
                    fn();
                } catch (error) {
                    logger.warn(`plugin socket ${what} listener threw`, { hostname, error: errorText(error) });
                }
            };

            const forceClose = (code: number, reason: string): void => {
                try {
                    raw.close(code, reason);
                } catch {
                    // Already closing, or closed; either way it is going.
                }
            };

            const release = (): void => {
                muted = true;
                forceClose(1000, 'plugin disposed');
                settleClosed(1000, 'plugin disposed');
            };

            const settleClosed = (code?: number, reason?: string): void => {
                if (state === 'closed') return;
                const wasConnecting = state === 'connecting';
                state = 'closed';
                closedWith = { ...(code === undefined ? {} : { code }), ...(reason === undefined || reason === '' ? {} : { reason }) };
                clearTimeout(timer);
                registry.sockets.delete(release);
                if (wasConnecting) {
                    reject(
                        new PluginError(
                            `plugin "${manifest.id}" socket to "${hostname}" closed before it opened${code === undefined ? '' : ` (${code})`}`,
                        ).withCode('upstream'),
                    );
                    return;
                }
                if (muted) return;
                for (const listener of closeListeners) safely('close', () => listener(closedWith?.code, closedWith?.reason));
            };

            const timer = setTimeout(() => {
                if (state !== 'connecting') return;
                forceClose(1000, 'connect timeout');
                state = 'closed';
                registry.sockets.delete(release);
                reject(new PluginError(`plugin "${manifest.id}" socket to "${hostname}" did not open within ${timeoutMs}ms`).withCode('timeout'));
            }, timeoutMs);

            const socket: PluginSocket = {
                send: text => {
                    if (state !== 'open') {
                        logger.debug('plugin socket send after close ignored', { hostname });
                        return;
                    }
                    try {
                        raw.send(text);
                    } catch (error) {
                        logger.debug('plugin socket send failed', { hostname, error: errorText(error) });
                    }
                },
                close: (code, reason) => {
                    // A client may only send 1000 or 3000–4999, and the platform throws on anything else.
                    const allowed = code === undefined || code === 1000 || (code >= 3000 && code <= 4999) ? (code ?? 1000) : 1000;
                    forceClose(allowed, reason ?? '');
                },
                onMessage: listener => void messageListeners.push(listener),
                onClose: listener => {
                    closeListeners.push(listener);
                    // Registered after it closed: told on the next turn, so no listener waits forever.
                    if (state === 'closed' && !muted) {
                        const { code, reason } = closedWith ?? {};
                        queueMicrotask(() => safely('close', () => listener(code, reason)));
                    }
                },
            };

            registry.sockets.add(release);

            raw.addEventListener('open', () => {
                if (state !== 'connecting') return;
                if (registry.closed) {
                    release();
                    return;
                }
                state = 'open';
                clearTimeout(timer);
                resolve(socket);
            });

            raw.addEventListener('message', event => {
                if (state !== 'open') return;
                if (typeof event.data !== 'string') {
                    logger.debug('plugin socket binary frame dropped', { hostname });
                    return;
                }
                const text = event.data;
                if (Buffer.byteLength(text, 'utf8') > PLUGIN_SOCKET_MAX_FRAME_BYTES) {
                    logger.warn('plugin socket closed: a frame was over the size limit', { hostname, limit: PLUGIN_SOCKET_MAX_FRAME_BYTES });
                    forceClose(3009, 'frame too large');
                    settleClosed(3009, 'frame too large');
                    return;
                }
                for (const listener of messageListeners) safely('message', () => listener(text));
            });

            raw.addEventListener('close', event => settleClosed(event.code, event.reason));
            // An error is always followed by a close, which is where it is reported.
            raw.addEventListener('error', () => logger.debug('plugin socket error', { hostname }));
        });
    }

    /**
     * Whether network discovery has been tried and has never found anything, which on a container
     * means its network cannot carry multicast to the station. For the console to say once.
     */
    discoverySeesNothing(): boolean {
        return this.options.discoverer.seesNothing();
    }

    /**
     * `host.discover`: a query the manifest named, run by the host's one discoverer, with every
     * address that answered admitted to this plugin's allowlist as an operator-supplied one. That is
     * what lets a plugin reach a device it found without the `network.open` grant, and without
     * certificate checks over `host.tls`, exactly as it could one the operator typed in: a device
     * that answered on the station's own network is the operator's device.
     */
    private async hostDiscover(
        manifest: PluginManifest,
        found: Set<string>,
        query: DiscoveryQuery,
        options: DiscoveryOptions | undefined,
    ): Promise<DiscoveredService[]> {
        const allowed = (manifest.permissions.discovery ?? []).some(entry =>
            entry.protocol === 'mdns' && query.protocol === 'mdns'
                ? entry.service === query.service
                : entry.protocol === 'ssdp' && query.protocol === 'ssdp' && entry.searchTarget === query.searchTarget,
        );
        if (!allowed) {
            const what = query.protocol === 'mdns' ? query.service : query.searchTarget;
            throw new PluginError(`plugin "${manifest.id}" does not declare discovery of ${query.protocol} "${what}"`).withCode('internal');
        }

        const timeoutMs = Math.max(250, Math.min(options?.timeoutMs ?? DISCOVERY_DEFAULT_TIMEOUT_MS, DISCOVERY_MAX_TIMEOUT_MS));
        const services = await this.options.discoverer.discover(query, timeoutMs);
        for (const service of services) {
            found.add(service.address.toLowerCase());
            if (service.location === undefined) continue;
            try {
                found.add(new URL(service.location).hostname.toLowerCase());
            } catch {
                // A location that is not a URL admits nothing.
            }
        }
        return services;
    }

    /**
     * `host.tls`: the socket policy applied to a raw TLS connection.
     *
     * Policed as the `https:` URL on the same host and port, so the one allowlist governs fetch,
     * sockets and this. Two things differ from {@link hostSocket}. It carries bytes rather than text
     * frames, so there is no frame cap: Node reads at most a TLS record at a time, and what a plugin
     * buffers on top of that is its own protocol's business. And it may skip verifying the peer's
     * certificate, which a Chromecast needs, but only for an address the operator typed in: a
     * device on their own network, which is the one case where no public root vouching for it is
     * normal rather than a warning.
     */
    private async hostTls(
        manifest: PluginManifest,
        networkEntries: () => Promise<NetworkEntry[]>,
        buckets: Map<string, RateBucket>,
        logger: PluginLogger,
        registry: SocketRegistry,
        url: string,
        options: PluginTlsOptions | undefined,
    ): Promise<PluginTlsSocket> {
        // `internal` for the storage guard's reason.
        if (!manifest.permissions.tls) {
            throw new PluginError(`plugin "${manifest.id}" does not declare the "tls" permission`).withCode('internal');
        }

        let target: URL;
        try {
            target = new URL(url);
        } catch {
            throw new PluginError(`plugin "${manifest.id}" asked for a TLS connection to an unparseable URL`).withCode('config');
        }
        if (target.protocol !== 'tls:') {
            throw new PluginError(`plugin "${manifest.id}" may only open tls: connections, got "${target.protocol}"`).withCode('config');
        }
        const port = Number(target.port);
        if (target.port === '' || !Number.isInteger(port) || port < 1 || port > 65_535) {
            throw new PluginError(`plugin "${manifest.id}" asked for a TLS connection with no port; tls: URLs have no default`).withCode('config');
        }

        const refuseClosed = (): never => {
            throw new PluginError(`plugin "${manifest.id}" was disposed; it may not open a TLS connection`).withCode('unavailable');
        };
        if (registry.closed) refuseClosed();
        if (registry.tls.size >= PLUGIN_TLS_MAX_OPEN) {
            throw new PluginError(`plugin "${manifest.id}" already holds ${PLUGIN_TLS_MAX_OPEN} open TLS connections, the most it may`).withCode(
                'internal',
            );
        }

        // `new URL` on a non-special scheme keeps an IPv6 literal bracketed; the policy wants it the
        // way an https: URL would hold it, and the connect wants it bare.
        const hostname = target.hostname.toLowerCase();
        const policed = new URL(`https://${hostname}:${port}/`);
        const entries = await networkEntries();
        const { entry, open } = this.assertAllowed(manifest, entries, logger, policed.toString());
        if (open) await this.assertPublicAddress(manifest, logger, policed);

        const verifyCertificate = options?.verifyCertificate ?? true;
        if (!verifyCertificate && (open || entry.operator !== true)) {
            throw new PluginError(
                `plugin "${manifest.id}" may skip verifying "${hostname}"'s certificate only for an address from its own settings`,
            ).withCode('forbidden');
        }

        const timeoutMs = Math.min(options?.connectTimeoutMs ?? PLUGIN_SOCKET_CONNECT_TIMEOUT_MS, PLUGIN_SOCKET_CONNECT_TIMEOUT_MS);
        const deadlineAt = Date.now() + timeoutMs;
        await this.consumeRateLimit(manifest, buckets, entry, deadlineAt);
        if (registry.closed) refuseClosed();

        const bare = hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname;
        let raw: HostTlsConnection;
        try {
            raw = this.options.openTls({ host: bare, port, verifyCertificate });
        } catch (error) {
            throw new PluginError(`plugin "${manifest.id}" could not open a TLS connection to "${hostname}": ${errorText(error)}`).withCode(
                'upstream',
            );
        }

        return new Promise<PluginTlsSocket>((resolve, reject) => {
            const dataListeners: ((bytes: Uint8Array) => void)[] = [];
            const closeListeners: ((reason?: string) => void)[] = [];
            let state: 'connecting' | 'open' | 'closed' = 'connecting';
            let closedWith: string | undefined;
            let lastError: string | undefined;
            let muted = false;

            const safely = (what: string, fn: () => void): void => {
                try {
                    fn();
                } catch (error) {
                    logger.warn(`plugin tls ${what} listener threw`, { hostname, error: errorText(error) });
                }
            };

            const destroy = (): void => {
                try {
                    raw.destroy();
                } catch {
                    // Already gone.
                }
            };

            const release = (): void => {
                muted = true;
                destroy();
                settleClosed(undefined);
            };

            const settleClosed = (reason: string | undefined): void => {
                if (state === 'closed') return;
                const wasConnecting = state === 'connecting';
                state = 'closed';
                closedWith = reason;
                clearTimeout(timer);
                registry.tls.delete(release);
                if (wasConnecting) {
                    reject(
                        new PluginError(
                            `plugin "${manifest.id}" TLS connection to "${hostname}" closed before the handshake finished${reason === undefined ? '' : `: ${reason}`}`,
                        ).withCode('upstream'),
                    );
                    return;
                }
                if (muted) return;
                for (const listener of closeListeners) safely('close', () => listener(closedWith));
            };

            const timer = setTimeout(() => {
                if (state !== 'connecting') return;
                destroy();
                state = 'closed';
                registry.tls.delete(release);
                reject(
                    new PluginError(`plugin "${manifest.id}" TLS connection to "${hostname}" did not open within ${timeoutMs}ms`).withCode('timeout'),
                );
            }, timeoutMs);

            const socket: PluginTlsSocket = {
                send: bytes => {
                    if (state !== 'open') {
                        logger.debug('plugin tls send after close ignored', { hostname });
                        return;
                    }
                    try {
                        raw.write(bytes);
                    } catch (error) {
                        logger.debug('plugin tls send failed', { hostname, error: errorText(error) });
                    }
                },
                close: () => {
                    destroy();
                    settleClosed(undefined);
                },
                onData: listener => void dataListeners.push(listener),
                onClose: listener => {
                    closeListeners.push(listener);
                    // Registered after it closed: told on the next turn, so no listener waits forever.
                    if (state === 'closed' && !muted) {
                        const reason = closedWith;
                        queueMicrotask(() => safely('close', () => listener(reason)));
                    }
                },
            };

            registry.tls.add(release);

            raw.on('secureConnect', () => {
                if (state !== 'connecting') return;
                if (registry.closed) {
                    release();
                    return;
                }
                state = 'open';
                clearTimeout(timer);
                resolve(socket);
            });

            raw.on('data', bytes => {
                if (state !== 'open') return;
                for (const listener of dataListeners) safely('data', () => listener(bytes));
            });

            // An error is always followed by a close, which is where it is reported, with the error
            // as its reason: a refused handshake and a device that hung up are different fixes.
            raw.on('error', error => {
                lastError = errorText(error);
                logger.debug('plugin tls error', { hostname, error: lastError });
            });
            raw.on('close', () => settleClosed(lastError));
        });
    }

    /**
     * The single place the egress policy lives: parseable, http(s), and a
     * hostname the manifest declared. Both the plugin's own URL and every
     * redirect target the server hands back go through here, so an upstream
     * cannot bounce a plugin somewhere its manifest never asked for.
     *
     * `from` is the URL the hop came from: present only for a redirect, where it
     * doubles as the base a relative `location` resolves against. It also
     * decides how the refusal is classified, because who caused it differs:
     * a URL the plugin built is `config` (the operator has a setting to fix, or
     * the plugin has a bug), while a redirect target is `upstream`, since at
     * that point the offending URL is the server's doing rather than bad plugin
     * input. A hostname the manifest never declared is the third case,
     * `forbidden`: the request is refused, but the plugin is healthy and the
     * next call for something it did declare will succeed.
     *
     * Returns the entry that matched as well as the URL, because which one it
     * was decides how the call is paced. First match wins, so a manifest that
     * lists a canonical host before a broader pattern keeps the stricter rate
     * for it.
     */
    private assertAllowed(
        manifest: PluginManifest,
        entries: NetworkEntry[],
        logger: PluginLogger,
        url: string,
        from?: URL,
    ): { url: URL; entry: NetworkEntry; open: boolean } {
        let target: URL;
        try {
            target = new URL(url, from);
        } catch {
            if (from !== undefined) {
                throw new PluginError(
                    `plugin "${manifest.id}" got an unparseable redirect target "${url}" from "${from.hostname.toLowerCase()}"`,
                ).withCode('upstream');
            }
            throw new PluginError(`plugin "${manifest.id}" requested an unparseable URL`).withCode('config');
        }

        if (target.protocol !== 'https:' && target.protocol !== 'http:') {
            if (from !== undefined) {
                logger.warn('plugin fetch denied: redirect hop is not an http(s) URL', {
                    protocol: target.protocol,
                    from: from.hostname.toLowerCase(),
                });
                throw new PluginError(
                    `plugin "${manifest.id}" was redirected by "${from.hostname.toLowerCase()}" to a non-http(s) URL ("${target.protocol}")`,
                ).withCode('upstream');
            }
            throw new PluginError(`plugin "${manifest.id}" may only fetch http(s) URLs, got "${target.protocol}"`).withCode('config');
        }

        const hostname = target.hostname.toLowerCase();
        const declared = entries.find(entry => matchesHost(hostname, entry.pattern));
        const matched = declared ?? this.openWebEntry(manifest, logger, hostname, from);
        if (matched === undefined) {
            const message = `plugin "${manifest.id}" is not allowed to reach "${hostname}"; add it to permissions.network`;
            if (from !== undefined) {
                logger.warn('plugin fetch denied: redirect hop hostname not in permissions.network', {
                    hostname,
                    from: from.hostname.toLowerCase(),
                });
                // The plugin asked for an allowlisted host and the server sent
                // it elsewhere, so this is the upstream misbehaving and it
                // counts against the plugin's health as such.
                throw new PluginError(`${message} (redirected there by "${from.hostname.toLowerCase()}")`).withCode('upstream');
            }

            logger.warn('plugin fetch denied: hostname not in permissions.network', { hostname });
            throw new PluginError(message).withCode('forbidden');
        }

        // `open` says the host was reached through the grant rather than the manifest, which is the
        // one case the address behind the name is checked: a declared host is the plugin author's or
        // the operator's choice and is allowed to be a Navidrome on the LAN, while an open one is
        // whatever the data said.
        return { url: target, entry: matched, open: declared === undefined };
    }

    /**
     * The other half of the private-address guard, for a host reached through `network.open`:
     * {@link openWebEntry} refuses a private NAME, and this refuses a public name that resolves to a
     * private address. See {@link privateAddressBehind} for what it does and does not close.
     *
     * `upstream` on a redirect hop for the reason {@link assertAllowed} gives it there — the plugin
     * asked for something allowed and the server sent it here — and `forbidden` on the first hop,
     * which is the plugin's own request and says nothing about its health.
     */
    private async assertPublicAddress(manifest: PluginManifest, logger: PluginLogger, target: URL, from?: URL): Promise<void> {
        const hostname = target.hostname.toLowerCase();
        let hidden: string | undefined;
        try {
            hidden = await privateAddressBehind(hostname, this.options.resolveAddresses);
        } catch (error) {
            logger.warn('plugin fetch denied: hostname could not be resolved', { hostname, error: errorText(error) });
            throw new PluginError(`plugin "${manifest.id}" could not resolve "${hostname}"`).withCode('upstream');
        }
        if (hidden === undefined) return;

        const redirected = from === undefined ? '' : ` (redirected there by "${from.hostname.toLowerCase()}")`;
        logger.warn('plugin fetch denied: hostname resolves to a private address', {
            hostname,
            address: hidden,
            ...(from === undefined ? {} : { from: from.hostname.toLowerCase() }),
        });
        throw new PluginError(
            `plugin "${manifest.id}" is not allowed to reach "${hostname}": it resolves to the private address ${hidden}${redirected}`,
        ).withCode(from === undefined ? 'forbidden' : 'upstream');
    }

    /**
     * The synthetic allowlist entry a plugin holding `network.open` gets for a
     * host its manifest never named, or `undefined` when it gets nothing.
     *
     * Consulted only after every declared entry has failed to match, so nothing
     * about a plugin with no grant changes, and a plugin that holds one still
     * keeps its manifest's own pacing wherever the manifest had something to
     * say. Where the manifest paced its REQUEST, that pacing applies here too —
     * `plugins/rss` asks to be held to the same one-per-second bucket as its
     * feeds, and a grant should not be a way to shed a limit the plugin set for
     * itself. Absent that, the bucket is per plugin rather than per host: what
     * is being paced is the station's own outbound rate to addresses nobody
     * published a limit for, and one limiter is what keeps a plugin walking a
     * site from becoming a burst.
     *
     * **Both halves are required, and that is the point.** The manifest must
     * have ASKED and the operator must have said yes. A row for a plugin whose
     * manifest never asked grants nothing, so a capability cannot be turned on
     * by reaching into the database for a plugin that has no idea it exists.
     *
     * A private address is refused here as if there were no grant at all — see
     * {@link isPrivateAddress}, and the capability's own description says so to
     * the operator in the same words — and the refusal falls through to the
     * ordinary message, which is the honest one for it: the address is not on
     * the allowlist and naming it there is exactly the fix.
     */
    private openWebEntry(manifest: PluginManifest, logger: PluginLogger, hostname: string, from: URL | undefined): NetworkEntry | undefined {
        if (isPrivateAddress(hostname)) return undefined;

        const asked = manifest.permissions.grants?.find(request => request.capability === NETWORK_OPEN);
        if (asked === undefined) return undefined;
        if (!this.grants.holds(manifest.id, NETWORK_OPEN)) return undefined;

        const pair = `${manifest.id} ${hostname}`;
        if (!this.auditedBypasses.has(pair)) {
            this.auditedBypasses.add(pair);
            // At info and once per pair. The allowlist's remaining job is
            // disclosure, and a grant nobody can see exercised has ended it.
            logger.info('plugin reached a host off its allowlist, permitted by the network.open grant', {
                hostname,
                ...(from === undefined ? {} : { redirectedFrom: from.hostname.toLowerCase() }),
            });
        }

        return {
            pattern: hostname,
            bucket: asked.bucket ?? `${NETWORK_OPEN}:${manifest.id}`,
            ...(asked.ratePerSecond === undefined ? {} : { ratePerSecond: asked.ratePerSecond }),
        };
    }

    /**
     * Waits for headroom rather than failing outright: a plugin that bursts is
     * usually doing something legitimate (a paged catalog walk), and pacing it
     * is friendlier to the upstream API than making the plugin implement its own
     * back-off. Parking is paid for out of the call's budget, so a plugin that
     * is over quota by more time than it has left is rejected instead.
     *
     * The bucket comes from the allowlist entry that matched, so an upstream
     * that publishes a limit gets paced at it and the plugin does not have to
     * carry a pacer of its own.
     */
    private async consumeRateLimit(
        manifest: PluginManifest,
        buckets: Map<string, RateBucket>,
        entry: NetworkEntry,
        deadlineAt: number,
    ): Promise<void> {
        let bucket = buckets.get(entry.bucket);
        if (bucket === undefined) {
            const limiter = limiterFor(entry.ratePerSecond);
            bucket = { limiter, queue: new RateLimiterQueue(limiter, { maxQueueSize: MAX_RATE_LIMIT_QUEUE }) };
            buckets.set(entry.bucket, bucket);
        }

        // The limiter knows exactly how long the wait would have been, so the
        // refusal carries it: `pluginHttpError` turns `retryAfterMs` into a real
        // `Retry-After` header, which is the difference between a client that
        // backs off correctly and one that hammers.
        const rate =
            entry.ratePerSecond === undefined
                ? `${PLUGIN_FETCH_REQUESTS_PER_WINDOW} per ${PLUGIN_FETCH_WINDOW_SECONDS}s`
                : `${entry.ratePerSecond} per second`;
        const overQuota = (waitMs: number): never => {
            throw new PluginError(`plugin "${manifest.id}" is over its fetch rate limit for "${entry.bucket}" (${rate})`)
                .withCode('rate_limited')
                .withRetry(waitMs);
        };

        // Refused before queueing when the window will not refill inside the budget, which is the
        // one thing the queue cannot do for us: its own `expiresUnixAt` is in whole SECONDS and is
        // only swept when the queue next ticks, so a call with 50ms left would otherwise sit there
        // for the best part of a second before being told no. This keeps a doomed call cheap and is
        // what carries the real `Retry-After`.
        const state = await bucket.limiter.get(manifest.id);
        if (state !== null && state.remainingPoints <= 0 && state.msBeforeNext >= deadlineAt - Date.now()) {
            overQuota(state.msBeforeNext);
        }

        // Otherwise queue, FIFO. This used to be a hand-rolled consume-sleep-retry, which was two
        // things wrong at once: it slept exactly once, so under contention everyone woke together
        // and raced for the same refilled points and the losers failed outright — and even with the
        // retry looped, a race has no order, so a caller could be starved indefinitely while others
        // won. `RateLimiterQueue` is the library's answer to both: one waiter is admitted at a time,
        // in arrival order, woken by the limiter's own timer rather than by polling.
        //
        // `expiresUnixAt` is the backstop for a call that outlives its budget while queued. Ceiled
        // rather than floored, because flooring a deadline that is 200ms away lands it in the
        // current second and the sweep would drop the request before it ever had a turn.
        try {
            await bucket.queue.removeTokens(1, manifest.id, Math.ceil(deadlineAt / 1000));
        } catch (rejection) {
            if (!(rejection instanceof RateLimiterQueueError)) throw rejection;
            // Expired in the queue, or the queue is full. Neither carries a wait, so it is read back
            // off the limiter: the caller still deserves a real number to back off by.
            const after = await bucket.limiter.get(manifest.id);
            overQuota(after?.msBeforeNext ?? 0);
        }
    }

    /**
     * One logical request, including any redirects the server asks for.
     *
     * The chain is followed by hand rather than by `redirect: 'follow'`: undici
     * would happily chase a 302 from an allowlisted API into 169.254.169.254 or
     * a loopback port, and by the time the response came back the request the
     * manifest forbids would already have been made. Following it here means
     * every hop clears {@link PluginHostFactory.assertAllowed} first.
     *
     * The whole chain shares the call's remaining budget. A per-hop timer would
     * let a server multiply the plugin's timeout by the hop cap just by
     * redirecting slowly. `budgetMs` is carried alongside for the timeout
     * message only: what the plugin asked for is what it should be told it
     * exceeded, not whatever fraction of it this attempt was given.
     */
    private async sendRaw(
        manifest: PluginManifest,
        entries: NetworkEntry[],
        logger: PluginLogger,
        target: URL,
        init: HostFetchInit | undefined,
        controller: AbortController,
        budgetMs: number,
    ): Promise<SentResponse> {
        {
            let current = target;
            let method: HostFetchMethod = init?.method ?? 'GET';
            // Set once, outside the hop loop, so every hop in the chain is
            // identified the same way rather than only the first.
            let headers: Record<string, string> = withUserAgent({ ...init?.headers }, manifest);
            let body = init?.body;

            for (let hop = 0; ; hop++) {
                const response = await this.roundTrip(manifest, current, method, headers, body, controller, budgetMs);

                const location = response.headers.get('location') ?? undefined;
                // A 3xx with nothing to follow is just a response; hand it back
                // and let the plugin decide what it means.
                if (!REDIRECT_STATUSES.has(response.status) || location === undefined) return { response, url: current, redirected: hop > 0 };

                // This hop is being left behind either way, so release its socket
                // now. `hostFetch` used to read every hop's body on its way past;
                // handing the live response back means somebody has to say when a
                // body is finished with, and for an abandoned hop that is here.
                await cancelBody(response);

                if (hop >= MAX_PLUGIN_FETCH_REDIRECTS) {
                    const hostname = current.hostname.toLowerCase();
                    logger.warn('plugin fetch denied: too many redirects', { hostname, hops: hop + 1 });
                    throw new PluginError(
                        `plugin "${manifest.id}" fetch to "${hostname}" failed: too many redirects (over ${MAX_PLUGIN_FETCH_REDIRECTS})`,
                    ).withCode('upstream');
                }

                // Hops are checked, but not charged: the redirect cap is what
                // bounds a chain, and spending the plugin's allowance on moves
                // it did not ask for would pace it for the server's choices.
                const { url: next, open } = this.assertAllowed(manifest, entries, logger, location, current);
                if (open) await this.assertPublicAddress(manifest, logger, next, current);

                // Method rewriting per the fetch spec: 303 means "go look at
                // this other thing", and 301/302 after a POST is what every
                // client has done since Netscape. 307/308 exist precisely to
                // preserve the method, so they do.
                if ((response.status === 303 && method !== 'HEAD') || ((response.status === 301 || response.status === 302) && method === 'POST')) {
                    method = 'GET';
                    body = undefined;
                    headers = withoutHeaders(headers, BODY_HEADERS);
                }

                // Crossing an origin drops credentials even when the new host is
                // itself allowlisted: being allowed to talk to a host is not the
                // same as being allowed to hand it another host's bearer token.
                if (next.origin !== current.origin) headers = withoutHeaders(headers, CREDENTIAL_HEADERS);

                current = next;
            }
        }
    }

    /** One HTTP round trip, live. Flattening and reading the body are the caller's. */
    private async roundTrip(
        manifest: PluginManifest,
        target: URL,
        method: HostFetchMethod,
        headers: Record<string, string>,
        body: string | undefined,
        controller: AbortController,
        budgetMs: number,
    ): Promise<Response> {
        const hostname = target.hostname.toLowerCase();

        try {
            return await fetch(target, {
                method,
                headers,
                body,
                signal: controller.signal,
                // 'manual', so the allowlist gets a say on every hop; `sendRaw`
                // does the following.
                redirect: 'manual',
            });
        } catch (error) {
            throw this.transportFailure(manifest, hostname, controller, budgetMs, error, { method });
        }
    }

    /**
     * What a failure on the wire means, in the vocabulary a plugin branches on.
     *
     * Shared by the request and the body read, which used to be one try block and
     * are now two calls: the response is handed back live so a stream can hold
     * it, which means the body is read after {@link roundTrip} has returned. A
     * second copy of this classification is how "body over the cap" quietly stops
     * being an `upstream` PluginError and starts being a bare `Error` nothing
     * knows what to do with.
     *
     * A deadline the host imposed and an upstream that could not be reached are
     * different answers (504 vs 502), and a caller deciding whether to retry
     * needs them apart: the timeout may just need a bigger budget, the connection
     * failure will not care.
     */
    private transportFailure(
        manifest: PluginManifest,
        hostname: string,
        controller: AbortController,
        budgetMs: number,
        error: unknown,
        meta: Record<string, unknown> = {},
    ): unknown {
        // Something upstream of here may already have classified itself.
        // Re-wrapping it would relabel a precise failure as a generic transport
        // one and lose the code the caller was meant to branch on.
        if (isPluginError(error)) return error;

        const aborted = controller.signal.aborted;
        const reason = aborted ? `timed out after ${budgetMs}ms` : causeText(error);
        this.pluginLog.for(manifest.id).warn('plugin fetch failed', { hostname, ...meta, error: reason });

        return new PluginError(`plugin "${manifest.id}" fetch to "${hostname}" failed: ${reason}`, { cause: error }).withCode(
            aborted ? 'timeout' : 'upstream',
        );
    }
}

/**
 * One track as the fetcher describes it, as the SDK's own shape.
 *
 * Every optional field is carried only when the fetcher actually said, which is the same rule the
 * Spotify plugin's own mapping follows: a station reads a missing advisory as "nobody vouched for
 * this" and a missing year as "any era", and defaulting either one here would be this file
 * inventing a fact about a record. `playable` has no counterpart and is dropped: what the station
 * does about a copy it cannot fetch belongs to the fetch, which answers 410 and writes it off.
 */
function toProviderTrack(track: FetchedPlaylistTrack): ProviderTrack {
    return {
        id: track.id,
        title: track.title,
        artists: track.artists ?? [],
        album: track.album,
        durationMs: track.durationMs,
        isrc: track.isrc,
        artworkUrl: track.artworkUrl,
        ...(typeof track.popularity === 'number' ? { popularity: track.popularity } : {}),
        ...(typeof track.year === 'number' ? { year: track.year } : {}),
        ...(track.advisory === 'clean' || track.advisory === 'explicit' ? { advisory: track.advisory } : {}),
    };
}
