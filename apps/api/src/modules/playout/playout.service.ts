import { timingSafeEqual } from 'node:crypto';
import { Injectable } from 'injectkit';
import { httpError } from '@maroonedsoftware/errors';
import { Logger } from '@maroonedsoftware/logger';
import type { MusicProviderPluginInstance } from '@deadair/plugin-sdk';
import { pluginHttpError } from '#modules/plugins/plugin.error.http.js';
import { PluginInvoker } from '#modules/plugins/plugin.invoker.js';
import { PluginRegistry } from '#modules/plugins/plugin.registry.js';
import { StreamService } from '#modules/stream/stream.service.js';
import { LiquidsoapEndpoint } from './liquidsoap.endpoint.js';
import { Rundown } from './rundown.js';
import type { PlayoutAiredQuery, PlayoutBridgeHeaders, SpotifyLoginHeaders, SpotifySessionLogin } from './types/playout.types.js';

/** The plugin the track shim borrows a session from. */
const SPOTIFY_PLUGIN_ID = 'deadair.spotify';

/**
 * The app's side of the playout bridge.
 *
 * Two inbound calls, both from the stream container and neither from a browser:
 * Liquidsoap telling us which item actually started, and the track shim asking
 * for a login. The console-facing transport surface joins them in a later phase.
 */
@Injectable()
export class PlayoutService {
    constructor(
        private readonly rundown: Rundown,
        private readonly endpoint: LiquidsoapEndpoint,
        private readonly registry: PluginRegistry,
        private readonly invoker: PluginInvoker,
        private readonly stream: StreamService,
        private readonly logger: Logger,
    ) {}

    /**
     * Record the item Liquidsoap has just put on air.
     *
     * Answers 204 even for an id the rundown does not know. The caller is a
     * fire-and-forget `http.post` inside the streaming script that cannot act on
     * a failure, and an unknown id is an ordinary event rather than an error: it
     * is what a Liquidsoap that outlived an app restart reports for the item it
     * is still playing. {@link Rundown.markAired} declines to invent it into the
     * running order, which is the whole handling it needs.
     *
     * @throws 404 while the bridge secret is unseeded (the route is not usable
     *   yet), 401 when the presented secret does not match.
     */
    async confirmAired(query: PlayoutAiredQuery, headers: PlayoutBridgeHeaders): Promise<void> {
        this.requireBridgeSecret(headers['x-playout-secret']);

        if (!this.rundown.markAired(query.item)) {
            this.logger.warn('playout: aired notify named an item the rundown does not hold', { item: query.item });
        }
    }

    /**
     * Mint a login for the track shim from the connected Spotify plugin.
     *
     * The shim runs beside Liquidsoap and opens its own session with Spotify,
     * because a Spotify track comes off the CDN encrypted and cannot be handed
     * over as a URL the way any other source's audio can. What it borrows is a
     * username and a live access token; the plugin keeps the account, the
     * refresh token and the vault.
     *
     * The token in this response never reaches a browser: the route generates no
     * SDK client, and the only caller is a process on the same host presenting a
     * secret out of `radio.env`.
     *
     * @throws 404 while the login secret is unseeded, 401 on a secret mismatch,
     *   503 when no connected Spotify plugin can supply a login — which the shim
     *   treats as retryable, because it comes up long before anyone has
     *   authorised anything. A plugin that throws is translated by
     *   {@link pluginHttpError}, so an expired authorisation reads as 502 and an
     *   unreachable Spotify as 503 rather than both as a bare 500.
     */
    async spotifySessionLogin(headers: SpotifyLoginHeaders): Promise<SpotifySessionLogin> {
        await this.requireLoginSecret(headers['x-spotify-login-secret']);

        const record = this.registry.get(SPOTIFY_PLUGIN_ID);
        const instance = record?.instance as MusicProviderPluginInstance | undefined;
        if (record?.status !== 'active' || typeof instance?.getSessionCredentials !== 'function') {
            throw httpError(503).withDetails({ message: 'the Spotify plugin is not running, so it cannot supply a session login' });
        }

        let credentials: Awaited<ReturnType<NonNullable<MusicProviderPluginInstance['getSessionCredentials']>>>;
        try {
            credentials = await this.invoker.invoke(SPOTIFY_PLUGIN_ID, 'catalog.getSessionCredentials', async () =>
                instance.getSessionCredentials!(),
            );
        } catch (error) {
            // The plugin's own vocabulary, translated. Without this an unreachable
            // Spotify — or a token refresh that fails — is a bare 500, which the shim
            // can only report as a number; mapped, an expired authorisation is a 502
            // and a network blip a 503, and the shim's backoff treats them sensibly.
            throw pluginHttpError(SPOTIFY_PLUGIN_ID, error);
        }

        if (!credentials) {
            throw httpError(503).withDetails({ message: 'Spotify is not connected; authorise the plugin in the console first' });
        }

        // Deliberately not logged with the token, and not at info: this runs on the
        // shim's first fetch and after every reconnect, which is worth seeing.
        this.logger.info('playout: handed the track shim a Spotify session login', { username: credentials.username });
        return { username: credentials.username, accessToken: credentials.accessToken };
    }

    /**
     * Gate the shim's login on its own secret, which is separate from the bridge
     * one on purpose: this route hands out an access token, while the bridge only
     * moves item ids, so one leaking must not spend the other.
     *
     * Read per call rather than cached like the bridge secret, because this is
     * not on the reconcile loop — the shim asks once per session.
     */
    private async requireLoginSecret(presented: string): Promise<void> {
        const { spotifyLoginSecret } = await this.stream.settings();
        if (!spotifyLoginSecret) {
            throw httpError(404).withDetails({ message: 'no Spotify login secret is seeded, so this endpoint is disabled' });
        }
        if (!safeEqual(presented, spotifyLoginSecret)) {
            throw httpError(401).withDetails({ message: 'invalid Spotify login secret' });
        }
    }

    /**
     * Gate an internal call on the shared bridge secret.
     *
     * Constant-time, because this is a bare secret compared on every boundary:
     * a length-then-bytes short circuit leaks it a byte at a time to anything
     * that can time the response.
     */
    private requireBridgeSecret(presented: string): void {
        const expected = this.endpoint.secret();
        if (!expected) {
            // Not seeded, so nothing could match. 404 rather than 401: the route is
            // not merely refusing this caller, it cannot serve anyone yet.
            throw httpError(404).withDetails({ message: 'the playout bridge is not configured' });
        }
        if (!safeEqual(presented, expected)) {
            throw httpError(401).withDetails({ message: 'invalid playout bridge secret' });
        }
    }
}

/** Constant-time compare that tolerates differing lengths. */
function safeEqual(a: string, b: string): boolean {
    const left = Buffer.from(a);
    const right = Buffer.from(b);
    // timingSafeEqual throws on a length mismatch, and the length is not the secret.
    return left.length === right.length && timingSafeEqual(left, right);
}
