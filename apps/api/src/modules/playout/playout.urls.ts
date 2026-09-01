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
 * than a second one beside it. The console fetches it through the SDK with its
 * bearer and plays a blob; the player fetches it with no session on a URL that
 * `AudioUrlSigner` has signed over the path. One route, two ways in, and
 * `signed.audio.middleware` is the gate on both. This builds the unsigned form:
 * signing needs the secret, and the five places that hand a URL to a player do
 * it there. See the note on the operation in `render.ck`.
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
 * Where a mixer fetches one blob out of the segment store, by its own checksum.
 *
 * {@link segmentAudioUrl}'s sibling and built off the same parent, because it is the same module's
 * route. What it exists for is the parts of a join that are NOT segments: a take of speech made on
 * the way to a padded break, and a soundboard pad, neither of which has a row in `deadair.segments`
 * and neither of which ever will.
 */
export function storedAudioUrl(base: string, checksum: string, ext: string): string {
    return `${base.replace(/\/playout$/, '')}/audio/${checksum}/${ext}`;
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
 * a secret in a HEADER, and this is fetched by the same headerless Liquidsoap GET
 * that fetches segment audio. It is gated the same way as that route instead: the
 * resolver signs the URL it hands the player, and `signed.audio.middleware` reads
 * the token off the query. See the note on the operation in `playout.ck`.
 */
export function trackAudioUrl(base: string, sourceId: string): string {
    return `${base}/audio/${sourceId}`;
}
