import type { ServerKitMiddleware } from '@maroonedsoftware/koa';
import { HLS_PATH_PREFIX } from './hls.heartbeat.middleware.js';

/**
 * The HLS output is a BROADCAST, so any page may fetch it.
 *
 * Native playback never needed this and that is what made it hard to see. An `<audio src>`
 * pointed at a playlist is not a CORS request at all: the media element fetches it in no-cors
 * mode and the browser applies no origin check, so Safari, a hardware player and the console's
 * own preview all worked. A JavaScript player does not do that. hls.js and everything built on
 * it read the playlist over `fetch`/XHR so they can parse it and drive Media Source Extensions
 * themselves, and an XHR IS origin-checked. Measured against the live station from a
 * third-party player page: the playlist answered 200 with `Vary: Origin` and no
 * `Access-Control-Allow-Origin`, so the player was blocked on its very first request and
 * reported nothing more useful than a failed stream.
 *
 * ## Why this cannot be another entry in the allowlist
 *
 * `setup.middleware` allows the SPA and API base URLs with `credentials: true`, because the web
 * SDK sends the httpOnly refresh cookie cross-origin and a credentialed response missing that
 * header is blocked. Credentialed CORS forbids the `*` wildcard, so the console's needs and a
 * public stream's are not the same policy and cannot be served by one list. They do not need to
 * be: an HLS request carries no session and never should. It is an anonymous `GET` for a file,
 * which is exactly the case `*` without credentials describes.
 *
 * So this OVERRIDES the global answer for this prefix rather than extending it, and stripping
 * `Access-Control-Allow-Credentials` is not tidying — a response carrying both `*` and
 * credentials is rejected by the browser, which would have swapped one CORS failure for
 * another on the one origin (the console's) that used to work.
 *
 * ## Why it writes on the way out
 *
 * Pushed OUTSIDE the global CORS middleware, and the headers are set after `await next()` for
 * that reason: Koa unwinds outermost-last, so this is the final writer and wins whatever the
 * global middleware decided on the way in. Setting them before `next()` instead would put this
 * first and let the global one overwrite it, which is the same bug with no symptom until
 * somebody loads the stream from the console's own origin.
 *
 * ## Why there is no preflight branch
 *
 * A player fetches a playlist and a segment with a plain `GET` and no header a preflight would
 * be triggered by, so the browser sends the real request straight away and only reads the
 * response headers. A `Range` request would preflight, but that is for `EXT-X-BYTERANGE`
 * playlists and Liquidsoap writes whole-file segments. If a player ever does need one, it will
 * arrive as `OPTIONS` and be answered by the router rather than here, and this comment is the
 * note that it is missing on purpose.
 *
 * The SEGMENTS are not covered by any of this. They never reach the app: nginx serves them off
 * the volume, and the same header is set there. See `nginx/snippets/hls.conf`.
 */
export const hlsCorsMiddleware = (): ServerKitMiddleware => async (ctx, next) => {
    const isHls = ctx.path.startsWith(HLS_PATH_PREFIX);

    await next();

    if (!isHls) return;

    ctx.set('Access-Control-Allow-Origin', '*');
    ctx.remove('Access-Control-Allow-Credentials');
};
