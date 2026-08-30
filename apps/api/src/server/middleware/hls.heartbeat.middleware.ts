import type { AppConfig } from '@maroonedsoftware/appconfig';
import type { Context } from 'koa';
import type { ScopedContainer } from 'injectkit';
import { ServerKitMiddleware } from '@maroonedsoftware/koa';
import { HlsAudience } from '#modules/stream/hls.audience.js';
import { trustsProxy } from '#modules/shared/request.trust.js';
import { clientAddress } from './rate.limit.middleware.js';

/**
 * Counting HLS listeners, from the requests they make anyway.
 *
 * An HLS player holds no connection open, so nothing can be asked how many people are
 * listening. What it does instead is come back for the media playlist every target
 * duration, because that is the only way to learn about the next segment — so a
 * playlist request IS the tick, and this is where it is noticed. See
 * `modules/stream/hls.audience.ts` for what is done with it, and for why counting this
 * way is not the access-log guessing the audience gate exists to refuse.
 *
 * **Here rather than in the handler, for the reason the bridge secret is.** The service
 * is generated against the contract and is handed the path parameter, not the request:
 * the address and the user agent live on the context, which only a middleware has.
 * Gating the PREFIX also means a second HLS route added later is counted by
 * construction rather than by whoever remembers.
 *
 * It records and never refuses. Nothing here can fail a listener's request — a
 * heartbeat is a side effect of serving the playlist, and a station that stopped
 * serving playlists because it could not count them would have the failure exactly
 * backwards.
 *
 * **A heartbeat is a playlist that was SERVED**, which is why the tick is recorded
 * after the handler rather than in front of it. It used to be recorded on the way
 * in, on nothing but the path, so a client polling a URL that answered 404 counted
 * as a listener for as long as it kept asking. Measured on a live station: HLS
 * switched off and every playlist deleted, nothing listening to anything, and the
 * station still reported two listeners and stayed on air — writing breaks and
 * rendering speech for a client being handed errors. The gate is the reason this
 * matters rather than the number: in `audience` mode a request nobody answered was
 * enough to keep the mount up indefinitely.
 */

/**
 * The counted prefix. A trailing slash so it can only match a path SEGMENT, which is
 * the same reasoning as `BRIDGE_PATH_PREFIX`: without it a future `/hlsx` would be
 * counted by accident.
 */
export const HLS_PATH_PREFIX = '/hls/';

/**
 * Only the PLAYLISTS are a heartbeat.
 *
 * Segments are served by nginx and never reach this app, so in the ordinary deployment
 * this is belt and braces. It matters for the one that is not ordinary — an operator
 * proxying everything to the API — where counting segment requests too would multiply
 * one listener by however many segments they fetched inside the window.
 */
const IS_PLAYLIST = /\.m3u8$/;

export const hlsHeartbeatMiddleware = (config: AppConfig): ServerKitMiddleware => {
    // Read once at construction, as the rate limiter reads it: whether the edge in front
    // of this app can be believed is a property of the deployment, not of a request.
    const trusted = trustsProxy(config);

    return async (ctx, next) => {
        const isPlaylist = ctx.path.startsWith(HLS_PATH_PREFIX) && IS_PLAYLIST.test(ctx.path);

        // Before the tick, always: a request that throws must reach the error middleware
        // exactly as it would if nothing were counting, and a refusal is not a heartbeat,
        // so a throw from below skips the record by construction rather than by a branch.
        await next();

        // A status the handler set, which is why this is not `ctx.body !== undefined`: the
        // playlist route answers with a Buffer, and a 404 built by `httpError` further down
        // carries a body too. Anything from 400 up is the station failing to serve somebody,
        // and somebody who is not being served is not listening.
        if (!isPlaylist || ctx.status >= 400) return;

        const container = ctx.container as ScopedContainer;
        container.get(HlsAudience).seen(clientKey(ctx, trusted));
    };
};

/**
 * As much identity as an anonymous GET carries: who the edge says asked, and what they
 * said they were.
 *
 * The address alone would collapse a household behind one NAT into a single listener,
 * and the user agent alone would collapse everyone using the same player. Together they
 * are still an undercount rather than a count — two identical phones on one network are
 * one entry — and that is the direction to be wrong in, because the gate opens on one
 * listener, so an undercount can only ever make the station think fewer people are
 * there than are.
 *
 * `clientAddress` rather than `ctx.ip`, so this reads the same address the rate limiter
 * and the audit trail do, including the argument about which end of `X-Forwarded-For`
 * the edge can actually vouch for.
 *
 * **The undercount above assumes the address means something.** Behind a tunnel or a
 * reverse proxy it does not: nginx sets `X-Real-IP` to `$remote_addr`, which is the hop
 * rather than the listener, so every caller shares one address and this key collapses to
 * the user agent. That is wrong in BOTH directions — one client fetching the playlist
 * under two agents counts as two listeners, two people using one player count as one —
 * and it is not fixable here, because nothing on this side can tell a proxy's address
 * from a listener's. `REAL_IP_FROM` tells the edge, which can; see
 * `docs/internals/deployment.md`.
 */
export function clientKey(ctx: Pick<Context, 'ip' | 'req'>, trusted: boolean): string {
    const agent = ctx.req.headers['user-agent'];

    return `${clientAddress(ctx, trusted)} ${typeof agent === 'string' ? agent : ''}`;
}
