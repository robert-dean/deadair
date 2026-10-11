import { Injectable } from 'injectkit';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { Logger } from '@maroonedsoftware/logger';
import type { ProviderStream } from '@deadair/plugin-sdk';
import { signTrackToken } from './spotify.shim.client.js';

/**
 * The compose service's address, and NOT a fallback — see {@link ApplePlayerClient.serve}.
 *
 * It is what `docker-compose.yml` sets `APPLE_PLAYER_URL` to, so an operator who runs the profile gets
 * a working station without typing an address. What it deliberately is not is a default applied when
 * the setting is absent: most stations run no player at all, and a client that minted URLs at this
 * address anyway would have every Apple Music record fail its fetch four times and bench itself.
 */
export const COMPOSE_APPLE_PLAYER_URL = 'http://apple-player:3680';

/** How long a signed player URL stays good for. The shim's TTL, for the same reason. */
export const PLAYER_URL_TTL_MS = 30 * 60_000;

/**
 * The fetch budget sent with every player URL.
 *
 * Twelve minutes: long enough for any record a station airs to be captured in real time with room for
 * the browser to start, and inside `MAX_FETCH_BUDGET_MS` so it is not clamped. A shorter number here is
 * not a saving — the fetch finishes when the record does, and the budget is only what bounds a capture
 * that has gone wrong.
 */
export const PLAYER_FETCH_BUDGET_MS = 12 * 60_000;

/**
 * Mints the URL a record is fetched from when the record has to be PLAYED to be fetched.
 *
 * The sibling of {@link SpotifyShimClient} and deliberately its shape: a helper beside the audio chain
 * holds an authorization the app does not, the app signs a URL onto it, and `TrackAudioService` fetches
 * that URL and caches the bytes. What differs is only what the helper does to produce them — the shim
 * speaks Spotify's protocol, and `stream/apple-player` runs Apple's own web player in a Chrome with a
 * Widevine CDM and records what comes out of it.
 *
 * ## Why the app signs rather than the plugin
 *
 * A plugin never holds the bridge secret, and should not: it is the station's, shared with the stream
 * containers, and rotated by the app. So `resolveStreamUrl` in the Apple plugin cannot mint its own URL
 * however much the capability's wording suggests it — it asks the host through `host.trackFetcher`,
 * exactly as the Spotify plugin does, and the signing happens here. The plugin ends up holding no
 * secret at all, which is the arrangement the plugin trust rules want.
 *
 * ## The two numbers on the way out
 *
 * `fetchBudgetMs` is the one that matters and the one that is easy to leave off. A capture runs in real
 * time, so a four-minute record takes four minutes to arrive, and `TrackAudioService`'s default 90
 * seconds would cut every record off mid-song. It is sent as a CEILING for the longest record the
 * station will reasonably hold rather than per record, because the length of the record is not known
 * here — the binding's `duration_ms` is, but this is handed a track id and nothing else, and guessing
 * short is the failure mode that costs a capture.
 *
 * `expiresAt` is the token's own life, and it is the shim's number for the shim's reason: a signed URL
 * that leaked into a log should stop working.
 */
@Injectable()
export class ApplePlayerClient {
    /** Signs track URLs. The same secret gating Liquidsoap's `/control/*` and the Spotify shim's fetches. */
    private bridgeSecret = '';

    constructor(
        private readonly config: AppConfig,
        private readonly logger: Logger,
    ) {}

    /** Pushed in at `ready`, exactly as {@link SpotifyShimClient.useSecrets} is and for its reasons. */
    useSecrets(bridgeSecret: string): void {
        this.bridgeSecret = bridgeSecret;
    }

    /**
     * The URL for one record, or `undefined` when this station has no player.
     *
     * `undefined` rather than a throw on both of its causes, because they are the same thing to the
     * caller: a station whose stream half was never set up has no Apple Music audio, which is a normal
     * state and not a fault. The plugin passes it straight through and the item is skipped.
     */
    async serve(trackId: string): Promise<ProviderStream | undefined> {
        if (!trackId) return undefined;
        // No player, no URL. This is the difference between an item the station SKIPS and a binding it
        // BENCHES: a URL minted at an address nothing answers on fails its fetch, four failures write the
        // copy off, and the operator is left with Apple Music records permanently marked unplayable on a
        // station that was simply never given a player. Most stations never run one.
        if (!this.configured()) return undefined;
        if (!this.bridgeSecret) {
            // Same reasoning as the shim's: nothing could verify a signature yet, so a URL minted now
            // would be refused on air. Said once at warn rather than per record.
            this.warnOnce();
            return undefined;
        }

        const expiresAt = Date.now() + PLAYER_URL_TTL_MS;
        return {
            url: applePlayerTrackUrl(this.baseUrl(), trackId, signTrackToken(this.bridgeSecret, trackId, expiresAt)),
            expiresAt,
            // What `stream/apple-player` encodes by default. A station that set APPLE_PLAYER_FORMAT=mp3
            // serves `audio/mpeg`, and nothing here needs to know: `TrackAudioService` reads the content
            // type off the response and this field is advisory.
            mimeType: 'audio/flac',
            fetchBudgetMs: PLAYER_FETCH_BUDGET_MS,
        };
    }

    /**
     * Whether an operator has pointed this station at a player at all.
     *
     * Read per call rather than at construction, because `APPLE_PLAYER_URL` is a live config value and a
     * station that gains a player should not need a restart to use it.
     */
    configured(): boolean {
        return this.config.get('APPLE_PLAYER_URL', '') !== '';
    }

    /**
     * Where the player answers, and there is no default.
     *
     * Unlike the Spotify shim — which is compiled into the Liquidsoap container and therefore always at
     * a known loopback address — this is a separate container most stations do not run, so an unset
     * address means "no player" rather than "the usual place". {@link ApplePlayerClient.serve} gates on
     * that before anything is signed, and {@link COMPOSE_APPLE_PLAYER_URL} is what compose fills in.
     */
    private baseUrl(): string {
        return this.config.get('APPLE_PLAYER_URL', '').replace(/\/+$/, '');
    }

    private warned = false;

    private warnOnce(): void {
        if (this.warned) return;
        this.warned = true;
        this.logger.warn('stream: no bridge secret is seeded, so Apple Music records cannot be fetched from the player');
    }
}

/** The path the player serves a record on. Mirrors `spotifyTrackUrl`. */
export function applePlayerTrackUrl(base: string, trackId: string, token: string): string {
    return `${base}/track/${encodeURIComponent(trackId)}?t=${encodeURIComponent(token)}`;
}
