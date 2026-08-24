import { createHmac } from 'node:crypto';
import { Injectable } from 'injectkit';
import { AppConfig } from '@maroonedsoftware/appconfig';
import type { ProviderStream, TrackFetchSession } from '@deadair/plugin-sdk';
import { Logger } from '@maroonedsoftware/logger';
import { errorText } from '#modules/shared/error.text.js';

/**
 * The station's track fetcher, which today is the Spotify shim
 * (`stream/spotify-shim`): a binary running beside Liquidsoap that logs in to
 * Spotify, fetches a track off the CDN, decrypts it and re-serves it as plain
 * Ogg Vorbis.
 *
 * That is what makes a Spotify track an ITEM the player downloads ahead of air,
 * the same shape as any other pre-signed stream URL — so a skip lands at once,
 * because no audio is committed to a pipe the app cannot take back.
 *
 * This is app-side rather than in the plugin because the shim is stream
 * infrastructure, not part of Spotify: it is our binary, in our container,
 * signed with the secret that already gates the playout bridge. The plugin's
 * side of the arrangement is the login it lends, which it hands over through
 * `host.trackFetcher` and which is never stored anywhere.
 *
 * Named for the one fetcher this station has rather than dressed up as a
 * registry. The SDK capability is general because it is a public contract; the
 * implementation behind it is one binary, and a second provider needing its own
 * helper is what would earn the indirection.
 */

/**
 * Where the shim listens, as the app reaches it (`SHIM_ADDR` in spotify-shim-run.sh, published on
 * localhost by the compose file).
 */
export const DEFAULT_SHIM_BASE_URL = 'http://127.0.0.1:3679';

/**
 * How long a signed track URL stays valid.
 *
 * Comfortably longer than the gap between an item being pushed and the player
 * fetching it (the pusher keeps one item of lead), and short enough that a URL
 * which ends up in a log is not replayable for the rest of the day. Matches
 * `tokenTTL` in the shim, which enforces its own view of it.
 */
export const TRACK_URL_TTL_MS = 30 * 60_000;

/**
 * How long the session push may take.
 *
 * Short on purpose: this runs inside a plugin invocation that has to produce a
 * URL within its deadline, and the push is an optimisation — the shim can still
 * open a session on its own. Spending the resolve's budget waiting on it would
 * cost the item the very thing the push was meant to protect.
 */
export const SESSION_PUSH_TIMEOUT_MS = 2_000;

/**
 * How long the fetcher's own state may take to read.
 *
 * As short as the push beside it, and for a related reason: this is read on the way to composing an
 * answer for the console, and a shim that is not answering is itself the finding rather than
 * something to wait on.
 */
export const AUTHORIZATION_READ_TIMEOUT_MS = 2_000;

/** Starting an authorization mints a URL and reaches nobody, so this bounds only the hop itself. */
export const AUTHORIZATION_START_TIMEOUT_MS = 5_000;

/**
 * How long FINISHING an authorization may take, which is a different order of thing.
 *
 * Behind it is a token exchange with Spotify and then a full login, which is several round trips —
 * the shim bounds the pair at its own `fetchTimeout` of 90s. This has to outlast that, or the app
 * gives up on an authorization that then succeeds, and the operator is told it failed while the
 * station quietly starts working.
 */
export const AUTHORIZATION_FINISH_TIMEOUT_MS = 100_000;

/**
 * What the fetcher holds by way of a Spotify login.
 *
 * `authorized` is the fetcher's OWN stored authorization, which is the only kind login5 accepts, and
 * it is the field to read first when nothing plays: false here with a healthy plugin above it is a
 * station that lists playlists perfectly and cannot fetch a single record.
 */
export interface FetcherAuthorizationState {
    /** Whether the fetcher answered at all. False makes every field below it a default rather than a reading. */
    reachable: boolean;
    /** Whether this install has a stream half at all. False means there is nothing yet to authorize. */
    configured: boolean;
    /** Whether the fetcher holds its own stored authorization. */
    authorized: boolean;
    /** Whether a Spotify session is live right now. */
    session: boolean;
    /** The last reason a login was refused. Present is not the same as fatal: a session may have recovered since. */
    loginError?: string;
    /** An authorization already started and not yet finished, so an operator who lost the URL can be given it back. */
    pendingUrl?: string;
    /**
     * The address Spotify will return the browser to, as the fetcher itself computes it.
     *
     * Reported rather than derived here, because it comes from the fetcher's own listen address and
     * a console telling an operator which page is expected to fail to load must not be guessing.
     */
    callbackUrl?: string;
}

/**
 * What an authorization failure can be, as a status this app is willing to answer with.
 *
 * A closed set rather than whatever the fetcher said, because the fetcher's codes are about the
 * fetcher and these are about the station: its 404 means "no login secret here", which relayed
 * verbatim would tell an operator the route does not exist. See {@link refusalFor}.
 */
export type FetcherRefusalStatus = 400 | 502 | 503;

/** A failure the operator is owed a sentence about, carrying the status that says what to do next. */
export interface FetcherRefusal {
    ok: false;
    status: FetcherRefusalStatus;
    message: string;
}

export type FetcherResult<T> = { ok: true; value: T } | FetcherRefusal;

/**
 * The fetcher's own failure, as something the station can answer with.
 *
 * Only 400 survives as itself, and it is the one that matters: it means the ATTEMPT cannot succeed —
 * nothing pending, a URL left to go stale, a callback from some other authorization — so the operator
 * starts again and it works. Everything else resolves to "not the operator's move".
 *
 * The two that are translated rather than passed on are both about this app rather than about
 * Spotify. A 404 is the fetcher saying it holds no login secret, and a 401 is it holding a different
 * one from ours; relayed as they stand, the first reads as a missing route and the second as the
 * operator's session being rejected. Both are the stream half of the install not being set up, which
 * is what `503` says here and what the unseeded-secret branch above already answers.
 */
function refusalFor(status: number, message: string): FetcherRefusal {
    if (status === 400) return { ok: false, status: 400, message: message || 'the fetcher refused the authorization' };
    if (status === 404 || status === 401) {
        return { ok: false, status: 503, message: 'the app and the track fetcher do not agree on a login secret, so the stream half of this install is not set up' };
    }
    return { ok: false, status: 502, message: message || `the track fetcher answered ${status}` };
}

@Injectable()
export class SpotifyShimClient {
    /** Signs track URLs. The same secret gating Liquidsoap's `/control/*`. */
    private bridgeSecret = '';

    /** Gates the shim's `POST /session`. Separate on purpose: it lends out an account, not an item id. */
    private shimSecret = '';

    constructor(
        private readonly config: AppConfig,
        private readonly logger: Logger,
    ) {}

    /**
     * Pushed in at `ready` rather than read per call, the way
     * {@link LiquidsoapEndpoint} takes its own secret: both live behind a scoped
     * repository, and a resolve happens once per item on the reconcile path.
     * A rotated secret needs a restart, which the stream containers need anyway
     * — they read `radio.env` once at startup.
     */
    useSecrets(bridgeSecret: string, shimSecret: string): void {
        this.bridgeSecret = bridgeSecret;
        this.shimSecret = shimSecret;
    }

    /**
     * Lend the shim a login, and mint the URL the APP fetches the track from.
     *
     * The app, not Liquidsoap, and that is the whole of what changed here: the player is handed
     * `/playout/audio/{sourceId}` for every record now and `TrackAudioService` is the only thing that
     * ever fetches a provider, so there is exactly one consumer of this URL and one address that has
     * to work — {@link SpotifyShimClient.baseUrl}. A signed URL is valid at any address that reaches
     * the shim, because the token covers the track id and the expiry and not the host.
     *
     * `undefined` when the bridge secret is unseeded: nothing could verify a
     * signature yet, so a URL minted now would be refused on air. The caller
     * reads that as "this station has no fetcher", which is exactly what an
     * installation whose stream half was never set up is.
     */
    async serve(trackId: string, session: TrackFetchSession): Promise<ProviderStream | undefined> {
        if (!this.bridgeSecret || !trackId) return undefined;

        await this.pushSession(session);

        const expiresAt = Date.now() + TRACK_URL_TTL_MS;
        return {
            url: spotifyTrackUrl(this.baseUrl(), trackId, signTrackToken(this.bridgeSecret, trackId, expiresAt)),
            expiresAt,
            mimeType: 'audio/ogg',
        };
    }

    /**
     * Hand the shim the login it opens its own Spotify session with.
     *
     * Failures are logged and swallowed, and the URL is minted anyway. A push
     * that does not land is not the same as a track that cannot play: the shim
     * may well hold a perfectly good session already, and failing the resolve
     * would drop an item that would have aired. What a genuinely down shim costs
     * is the fetch, which fails where it is visible.
     */
    private async pushSession(session: TrackFetchSession): Promise<void> {
        if (!this.shimSecret) {
            this.logger.warn('stream: no Spotify shim secret is seeded, so the track fetcher was not handed a login');
            return;
        }

        try {
            const response = await fetch(`${this.baseUrl()}/session`, {
                method: 'POST',
                headers: { 'content-type': 'application/json', 'x-spotify-login-secret': this.shimSecret },
                body: JSON.stringify(session),
                signal: AbortSignal.timeout(SESSION_PUSH_TIMEOUT_MS),
            });
            if (!response.ok) {
                this.logger.warn('stream: the track fetcher refused a session push', { status: response.status });
            }
        } catch (error) {
            this.logger.warn('stream: could not hand the track fetcher a session', {
                error: errorText(error),
            });
        }
    }

    /**
     * What the fetcher says about its own Spotify login.
     *
     * Never throws, because every one of its failures is a state the console has to draw rather than
     * an error to raise: a shim that is not answering, a shim that has never been authorized, and a
     * shim whose stored login is being refused are three different things an operator does three
     * different things about, and only the first of them looks like a fault in this app.
     *
     * `reachable` is what keeps the other fields honest. Without it a shim that is simply down reads
     * as one that was never authorized, which is a sentence telling the operator to go and do
     * something that will not work.
     */
    async authorization(): Promise<FetcherAuthorizationState> {
        if (!this.shimSecret) {
            // Not seeded is not the same as not authorized: until the stream half of the install has
            // run, there is nothing here to authorize and nothing to say about it.
            return { reachable: false, configured: false, authorized: false, session: false };
        }

        try {
            const response = await fetch(`${this.baseUrl()}/health`, { signal: AbortSignal.timeout(AUTHORIZATION_READ_TIMEOUT_MS) });
            if (!response.ok) return { reachable: false, configured: true, authorized: false, session: false };

            const health = (await response.json()) as {
                session?: boolean;
                storedLogin?: boolean;
                loginError?: string;
                authorizeUrl?: string;
                callbackUrl?: string;
            };
            return {
                reachable: true,
                configured: true,
                // The STORED login is the one login5 accepts. A live session without one is a shim
                // running on a pushed token, which is the state this whole surface exists for.
                authorized: health.storedLogin === true,
                session: health.session === true,
                loginError: health.loginError,
                pendingUrl: health.authorizeUrl,
                callbackUrl: health.callbackUrl,
            };
        } catch (error) {
            this.logger.warn("stream: could not read the track fetcher's authorization", { error: errorText(error) });
            return { reachable: false, configured: true, authorized: false, session: false };
        }
    }

    /** Start the fetcher's one-time authorization, and hand back the URL the operator has to open. */
    async beginAuthorization(): Promise<FetcherResult<{ authorizeUrl: string; expiresInMs: number }>> {
        return this.control('/authorize', undefined, AUTHORIZATION_START_TIMEOUT_MS);
    }

    /**
     * Finish an authorization from the address the operator pasted.
     *
     * The URL is relayed WHOLE rather than taken apart here, because the shim already has the one
     * parser for it and two readings of the same address is one of them being wrong eventually.
     */
    async completeAuthorization(redirectUrl: string): Promise<FetcherResult<{ username: string }>> {
        return this.control('/authorize/complete', { redirectUrl }, AUTHORIZATION_FINISH_TIMEOUT_MS);
    }

    /**
     * The shape both authorization writes share: post, and report what came back.
     *
     * Reports rather than throws, and the difference from {@link SpotifyShimClient.pushSession} is
     * the caller: a push happens on the way to resolving a track and must never cost the item, while
     * these two happen because an operator pressed a button and are owed an answer. The shim's own
     * status is carried through, because it means something specific — 400 is this attempt and 502
     * is Spotify — and re-deriving that from a message would put the shim's wording in this file.
     */
    private async control<T>(path: string, body: unknown, timeoutMs: number): Promise<FetcherResult<T>> {
        if (!this.shimSecret) {
            return { ok: false, status: 503, message: 'the track fetcher has no login secret, so the stream half of this install has not been set up yet' };
        }

        let response: Response;
        try {
            response = await fetch(`${this.baseUrl()}${path}`, {
                method: 'POST',
                headers: { 'content-type': 'application/json', 'x-spotify-login-secret': this.shimSecret },
                body: JSON.stringify(body ?? {}),
                signal: AbortSignal.timeout(timeoutMs),
            });
        } catch (error) {
            this.logger.warn('stream: could not reach the track fetcher', { path, error: errorText(error) });
            return { ok: false, status: 503, message: 'the track fetcher is not answering' };
        }

        if (!response.ok) {
            // Plain text, because that is what the shim answers with on every failure path.
            const message = (await response.text().catch(() => '')).trim();
            return refusalFor(response.status, message);
        }

        return { ok: true, value: (await response.json()) as T };
    }

    /**
     * Where **the app** reaches the shim, for both things it does: pushing a session and fetching a
     * track.
     *
     * One address, because there is one fetcher. This used to be two — a `SPOTIFY_SHIM_URL` signed
     * into the track URL for Liquidsoap to fetch, and this one for the app's own calls — and the split
     * was a genuine trap: the two are different addresses in every deployment (an app on the host uses
     * the published port, an app in compose uses the service name, and Liquidsoap uses its own
     * loopback), so whichever consumer got handed the wrong one failed at a distance. A host-run app
     * handed `http://liquidsoap:3679` answers `ENOTFOUND` and records it as an unfetchable binding.
     *
     * `SPOTIFY_SHIM_URL` is deliberately still read as a fallback rather than deleted: an operator's
     * `.env` naming it should keep working rather than silently falling back to a default that is
     * wrong for their deployment. It is the wrong name for what it now means, and it goes once
     * nothing sets it.
     *
     * The default is right for a host-run app, since 3679 is published on localhost, and right in
     * the production image, where the shim is a process in the same container. It is wrong only
     * for an app reaching a shim in a sibling container, which sets `SPOTIFY_SHIM_CONTROL_URL`.
     */
    private baseUrl(): string {
        const configured = this.config.get('SPOTIFY_SHIM_CONTROL_URL', '') || this.config.get('SPOTIFY_SHIM_URL', DEFAULT_SHIM_BASE_URL);

        return trimSlashes(configured);
    }
}

const trimSlashes = (url: string): string => url.replace(/\/+$/, '');

/** The shim's per-track URL. Exported for tests and for diagnosing a pushed item. */
export function spotifyTrackUrl(base: string, trackId: string, token: string): string {
    return `${base}/track/${encodeURIComponent(trackId)}?t=${encodeURIComponent(token)}`;
}

/**
 * Sign a track URL for the shim: `<expiry-unix>.<base64url(hmac-sha256)>`.
 *
 * MUST match `verifyToken` in `stream/spotify-shim/token.go` byte for byte,
 * including the length-prefixed MAC input — that prefixing is what stops one
 * `(id, expiry)` pair being re-cut into another that signs the same bytes. Both
 * sides pin the same test vector, so changing the wire format on one without the
 * other fails a suite rather than silently 401ing every fetch on air.
 *
 * Signed rather than one-time because the shim is a separate process: a random
 * token would need shared state, where an HMAC needs only the secret both
 * already hold. It rides in the query string because Liquidsoap fetches a queued
 * item with no headers from us.
 */
export function signTrackToken(secret: string, trackId: string, expiresAtMs: number): string {
    const expiry = String(Math.floor(expiresAtMs / 1000));
    return `${expiry}.${trackMac(secret, trackId, expiry)}`;
}

function trackMac(secret: string, trackId: string, expiry: string): string {
    return createHmac('sha256', secret).update(`${trackId.length}:${trackId}:${expiry.length}:${expiry}`).digest('base64url');
}
