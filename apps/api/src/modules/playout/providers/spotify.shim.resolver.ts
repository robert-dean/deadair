import { createHmac } from 'node:crypto';
import { Injectable } from 'injectkit';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { LiquidsoapEndpoint } from '../liquidsoap.endpoint.js';
import { TrackResolver } from '../playout.capability.js';
import type { RundownItem } from '../rundown.js';

/**
 * Playout resolver for Spotify.
 *
 * Hands the player a URL on the track shim that runs beside Liquidsoap
 * (`stream/spotify-shim`), which fetches and decrypts the track from Spotify and
 * serves it as plain Ogg Vorbis. That is what makes a Spotify track an ITEM the
 * player downloads ahead of air, the same shape as any other pre-signed stream
 * URL — so a skip lands at once, because no audio is committed to a pipe the app
 * cannot take back.
 *
 * This is app-side rather than in the plugin because the shim is stream
 * infrastructure, not part of Spotify: it is our binary, in our container,
 * signed with the secret that already gates the playout bridge. The plugin's
 * side of the arrangement is `getSessionCredentials`, which lends the shim a
 * login.
 *
 * Inert until that secret is seeded, and it only ever answers for its own
 * plugin's items, so binding it unconditionally is harmless.
 */

/** The plugin whose items this resolver answers for. */
const SPOTIFY_PLUGIN_ID = 'deadair.spotify';

/** Where the shim listens inside the stream container (`SHIM_ADDR` in spotify-shim-run.sh). */
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

@Injectable()
export class SpotifyShimResolver extends TrackResolver {
    constructor(
        private readonly config: AppConfig,
        // The shim verifies with the same secret Liquidsoap's /control/* is gated
        // on, so it is read from the one place that already owns it.
        private readonly endpoint: LiquidsoapEndpoint,
    ) {
        super();
    }

    async resolve(item: RundownItem): Promise<string | undefined> {
        // Only this plugin's own items. Without the check another provider's id
        // would be pasted into a shim URL and handed over as if it were valid,
        // which is a failure the player would discover on air rather than here.
        if (item.pluginId !== SPOTIFY_PLUGIN_ID) return undefined;

        const secret = this.endpoint.secret();
        if (!secret || !item.externalId) return undefined;

        const token = signTrackToken(secret, item.externalId, Date.now() + TRACK_URL_TTL_MS);
        return spotifyTrackUrl(this.baseUrl(), item.externalId, token);
    }

    /**
     * `SPOTIFY_SHIM_URL` when set (a shim moved off the stream container), else
     * loopback.
     *
     * Loopback is both correct and the most robust default: the shim and
     * Liquidsoap are in the SAME container and Liquidsoap is the one fetching,
     * so there is no compose DNS to resolve and no dependence on the
     * host-published port. This is why nothing is probed here, unlike
     * {@link LiquidsoapEndpoint}, which describes the app-to-container direction.
     */
    private baseUrl(): string {
        return this.config.get('SPOTIFY_SHIM_URL', DEFAULT_SHIM_BASE_URL).replace(/\/+$/, '');
    }
}

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
