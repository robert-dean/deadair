import type { AppConfig } from '@maroonedsoftware/appconfig';

/**
 * The app's own playout URLs, as seen from the Liquidsoap container.
 *
 * They live here rather than in the stream module because two callers need them
 * and must not diverge: the stream config materializer writes the air
 * confirmation URL into `radio.env`, and the playout module serves the route it
 * names. A mismatch is silent — Liquidsoap fire-and-forgets that call — so the
 * string has exactly one owner.
 *
 * The base has to be configured rather than derived from an incoming request,
 * because nobody calls in: the app pushes to Liquidsoap, and the only inbound
 * call is the confirmation this URL is for.
 */

/**
 * Default base for a host-run app (`pnpm dev`) reached from the compose network.
 *
 * No `/api` prefix: the API mounts its routers at the root, and the prefix the SPA
 * uses is added and stripped by Vite's dev proxy (`apps/web/vite.config.ts`).
 * Liquidsoap talks to the API directly, so it must not carry one.
 */
export const DEFAULT_PLAYOUT_BASE_URL = 'http://host.docker.internal:3333/playout';

/** Base URL of the playout bridge, without a trailing slash. `PLAYOUT_BASE_URL` overrides. */
export function resolvePlayoutBaseUrl(config: AppConfig): string {
    return config.get('PLAYOUT_BASE_URL', DEFAULT_PLAYOUT_BASE_URL).replace(/\/+$/, '');
}

/**
 * The bridge segment every stream-container route sits under.
 *
 * It has to agree with `BRIDGE_PATH_PREFIX` in `bridge.secret.middleware.ts`,
 * which gates on it, and with the paths in `playout.ck`, which declare it. The
 * three cannot be one constant — the contract is a `.ck` file and the middleware
 * matches a path rather than building one — so the coupling is written down here
 * instead: a URL built without this segment reaches a route that does not exist,
 * and a route added outside it is one nothing checks the secret on.
 */
const BRIDGE = '/bridge';

/** Where Liquidsoap posts the id of the item that actually started. */
export function playoutAiredUrl(base: string): string {
    return `${base}${BRIDGE}/aired`;
}

/**
 * Where Liquidsoap posts that its queue stopped producing, and that it started
 * again.
 *
 * The state and the duration ride in the query, added by the caller: this is
 * built once at materialize time and written into `radio.env`, so the script
 * appends them per call the way it already does for the aired notify's item id.
 */
export function playoutStarveUrl(base: string): string {
    return `${base}${BRIDGE}/starve`;
}

/**
 * Where the player fetches a rendered segment's audio.
 *
 * The same route the console previews a segment through, deliberately, rather
 * than a second signed one beside it. That route is already anonymous because it
 * is the src of a media element, so a signed twin would gate one door of a room
 * with two, and what is behind either is audio the station is broadcasting
 * unauthenticated to anyone who opens the mount. See the note at the top of
 * `render.ck`.
 *
 * Derived from the playout base by dropping its last segment, rather than from a
 * config key of its own. Two keys naming the same server is two keys that can
 * disagree, and the disagreement would be silent: Liquidsoap fetches this with
 * nobody watching, so a wrong host is a segment that never plays rather than an
 * error anyone sees. The invariant is simply that `PLAYOUT_BASE_URL` names the
 * playout routes, so its parent is the app root — true for the default and for a
 * path-prefixed deployment (`https://station/api/playout` → `https://station/api`).
 */
export function segmentAudioUrl(base: string, segmentId: string): string {
    return `${base.replace(/\/playout$/, '')}/segments/${segmentId}/audio`;
}

/**
 * Where the player fetches the station's own copy of a record.
 *
 * Built off the playout base directly rather than off its parent, unlike
 * {@link segmentAudioUrl}: this route lives under `/playout/` because it is the
 * transport's own, while a segment is the render module's and is served where the
 * console previews it.
 *
 * Deliberately NOT under {@link BRIDGE}. Everything under that prefix is gated on
 * the shared secret, and this is fetched by the same headerless Liquidsoap GET
 * that fetches segment audio — see the note on the operation in `playout.ck` for
 * why signing it would gate one door of a room with two.
 */
export function trackAudioUrl(base: string, sourceId: string): string {
    return `${base}/audio/${sourceId}`;
}

/**
 * Where Icecast posts a listener arriving or leaving.
 *
 * The event is in the query because Icecast configures one URL per event and can
 * add nothing to a request but its own form fields. The SECRET is deliberately
 * not: Icecast presents it as HTTP basic instead, so it stays out of every access
 * log and error page an address can end up in.
 */
export function playoutListenerUrl(base: string, event: 'add' | 'remove'): string {
    return `${base}${BRIDGE}/listener?event=${event}`;
}
