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

/** Where Liquidsoap posts the id of the item that actually started. */
export function playoutAiredUrl(base: string): string {
    return `${base}/aired`;
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
    return `${base}/listener?event=${event}`;
}
