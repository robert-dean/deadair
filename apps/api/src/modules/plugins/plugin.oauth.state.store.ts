import { randomUUID, timingSafeEqual } from 'node:crypto';
import { Injectable } from 'injectkit';

/**
 * How long a minted `state` stays redeemable.
 *
 * Long enough for an operator to work through a provider's consent screen
 * (including a login and a 2FA prompt), short enough that an authorize link
 * left in a browser tab overnight is not still a live rebind of the station's
 * music source.
 */
export const PLUGIN_OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

interface PendingState {
    state: string;
    issuedAt: number;
}

/**
 * The host's record of the OAuth `state` values it minted.
 *
 * `GET /plugins/{id}/oauth/callback` is anonymous by necessity — the provider
 * redirects a browser there carrying no session of ours — so `state` is the
 * only thing separating a real callback from a forged one. Without it, anyone
 * who can reach the server can POST-by-redirect a code of their choosing and
 * rebind the station to their own account.
 *
 * That check is deliberately the HOST's and not the plugin's: it is a security
 * boundary on a route the host exposes, so it has to hold for every plugin
 * including a third-party one that never thought about CSRF. Plugins keep
 * receiving `state` in `getAuthorizeUrl` and the raw params in
 * `handleCallback`; they simply no longer have to be trusted with it.
 *
 * Storage is in-memory on purpose. `plugin_configs` would fire the reload
 * notify trigger on every authorize, and `host.storage` is the plugin's own
 * namespace, gated on a permission an OAuth plugin need not hold. The server is
 * single-process, so a restart mid-flow costs one more click on the authorize
 * link and nothing else.
 *
 * Time is plain `Date.now()` with no timers of its own, so tests can
 * fake-advance the clock across the TTL with nothing to flush.
 */
@Injectable()
export class PluginOAuthStateStore {
    /** Plugin id -> the one state currently redeemable for it. */
    private readonly pending = new Map<string, PendingState>();

    /**
     * Mints and stores the `state` for a new authorization attempt.
     *
     * One plugin has at most one live state: starting a fresh authorize
     * supersedes the previous one, so a half-finished attempt cannot be
     * completed later with a link the operator has already abandoned.
     */
    issue(pluginId: string): string {
        const state = randomUUID();
        this.pending.set(pluginId, { state, issuedAt: Date.now() });
        return state;
    }

    /**
     * Whether `state` is the live, unexpired state this host minted for
     * `pluginId`.
     *
     * Destructive on a match: a state is single-use, so a replayed callback is
     * rejected even inside the TTL. A miss leaves the pending entry alone, so a
     * prober firing guesses cannot knock out an authorization the operator is
     * partway through.
     */
    consume(pluginId: string, state: string | undefined): boolean {
        if (state === undefined || state === '') return false;

        const entry = this.pending.get(pluginId);
        if (entry === undefined) return false;

        if (Date.now() - entry.issuedAt > PLUGIN_OAUTH_STATE_TTL_MS) {
            this.pending.delete(pluginId);
            return false;
        }

        if (!matches(entry.state, state)) return false;

        this.pending.delete(pluginId);
        return true;
    }
}

/**
 * Constant-time equality. `timingSafeEqual` throws on unequal lengths, so the
 * length is compared first; that leaks only the length of a value we minted
 * ourselves as a fixed-size UUID.
 */
function matches(expected: string, candidate: string): boolean {
    const a = Buffer.from(expected, 'utf8');
    const b = Buffer.from(candidate, 'utf8');
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
}
