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
     * The default is right for a host-run app, since 3679 is published on localhost; an app in the
     * compose network sets `SPOTIFY_SHIM_CONTROL_URL` explicitly, which `docker-compose.prod.yml`
     * already does.
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
