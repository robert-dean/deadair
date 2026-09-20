/**
 * What this server HAS: whether it is there, which engines are installed, and which voices each of
 * them holds.
 *
 * Separate from `rhapsode.capabilities.ts`, which reads what an engine can DO. The two are different
 * questions with different lifetimes — a voice is created and deleted by an operator while the
 * station is running, and a build's cue list is fixed by whoever wrote the adapter — and only one of
 * them is worth caching.
 *
 * Everything here is for the console. Nothing a render does passes through this file: a break being
 * spoken names its engine and its voice out of the operator's own table, and asking the server to
 * confirm they exist before every line would be a round trip to learn what the refusal would have
 * said anyway.
 */

import { tryJsonBody, type HostFetchInit, type PluginLogger } from '@deadair/plugin-sdk';
import type { CoreHealth, EngineSummary, Voice } from '@maroonedsoftware/rhapsode-sdk';
import { PROBE_TIMEOUT_MS } from './rhapsode.manifest.js';

/** Everything needed to ask this server something, as the plugin holds it after `init`. */
export interface RhapsodeAccess {
    baseUrl: string;
    fetch: (url: string, init: HostFetchInit) => Promise<Response>;
    logger: PluginLogger;
}

/**
 * Whether the server is there, and what it thinks of itself.
 *
 * `/health` answers while every worker is down and never blocks on one, which is what makes it the
 * right probe: a station whose engines are all cold should still be told the address is correct.
 */
export async function fetchHealth(access: RhapsodeAccess): Promise<CoreHealth | undefined> {
    const response = await access.fetch(`${access.baseUrl}/health`, { timeoutMs: PROBE_TIMEOUT_MS });
    if (!response.ok) {
        await response.body?.cancel().catch(() => {});
        return undefined;
    }

    return await tryJsonBody<CoreHealth>(response);
}

/**
 * The engines this server has installed, whether or not any of them is running.
 *
 * Answers nothing rather than throwing for a server that will not say: this fills a form, and an
 * operator fixing a bad address needs the form rather than an error where the choices should be.
 */
export async function fetchEngines(access: RhapsodeAccess): Promise<EngineSummary[]> {
    const listed = await fetchList<EngineSummary>(access, `${access.baseUrl}/engines`, 'engines');

    return listed.filter(engine => typeof engine.id === 'string' && engine.id.length > 0);
}

/**
 * One engine's voices, as it currently holds them.
 *
 * Including any the operator has cloned into it, which is the half a static list could never have:
 * a voice created through the server's own API exists the moment it is uploaded, and it is the one
 * an operator is most likely to be looking for when they open this form.
 */
export async function fetchVoices(access: RhapsodeAccess, engine: string): Promise<Voice[]> {
    const listed = await fetchList<Voice>(access, `${access.baseUrl}/engines/${encodeURIComponent(engine)}/voices`, `voices of "${engine}"`);

    return listed.filter(voice => typeof voice.id === 'string' && voice.id.length > 0);
}

/**
 * A GET that answers an array, or nothing.
 *
 * Nothing covers every way this can go wrong — unreachable, refused, answered with something that is
 * not an array — because the caller does the same thing with all of them. A debug line records which
 * it was, since "the form offered no voices" and "the server said 404" are the same symptom to an
 * operator and different problems.
 */
async function fetchList<T>(access: RhapsodeAccess, url: string, what: string): Promise<T[]> {
    let response: Response;
    try {
        response = await access.fetch(url, { timeoutMs: PROBE_TIMEOUT_MS });
    } catch (error) {
        access.logger.debug(`rhapsode could not list ${what}`, { error: error instanceof Error ? error.message : String(error) });
        return [];
    }

    if (!response.ok) {
        await response.body?.cancel().catch(() => {});
        access.logger.debug(`rhapsode would not list ${what}`, { status: response.status });
        return [];
    }

    const body = await tryJsonBody<T[]>(response);
    return Array.isArray(body) ? body : [];
}
