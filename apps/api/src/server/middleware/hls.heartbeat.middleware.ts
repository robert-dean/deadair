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
        if (ctx.path.startsWith(HLS_PATH_PREFIX) && IS_PLAYLIST.test(ctx.path)) {
            const container = ctx.container as ScopedContainer;
            container.get(HlsAudience).seen(clientKey(ctx, trusted));
        }
        await next();
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
 */
export function clientKey(ctx: Pick<Context, 'ip' | 'req'>, trusted: boolean): string {
    const agent = ctx.req.headers['user-agent'];

    return `${clientAddress(ctx, trusted)} ${typeof agent === 'string' ? agent : ''}`;
}
