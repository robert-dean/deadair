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

/** Default base for a host-run app (`pnpm dev`) reached from the compose network. */
export const DEFAULT_PLAYOUT_BASE_URL = 'http://host.docker.internal:3333/api/playout';

/** Base URL of the playout bridge, without a trailing slash. `PLAYOUT_BASE_URL` overrides. */
export function resolvePlayoutBaseUrl(config: AppConfig): string {
    return config.get('PLAYOUT_BASE_URL', DEFAULT_PLAYOUT_BASE_URL).replace(/\/+$/, '');
}

/** Where Liquidsoap posts the id of the item that actually started. */
export function playoutAiredUrl(base: string): string {
    return `${base}/aired`;
}
