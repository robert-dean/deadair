import { PluginError, errorText, jsonBody, type PluginHost, type ProviderStream } from '@deadair/plugin-sdk';

import { RESOLVE_TIMEOUT_MS } from './ytmusic.manifest.js';

/** What the sidecar answers with. Its README is the contract; this is the half we read. */
interface ResolvedBody {
    url?: string;
    expiresAt?: number;
    mimeType?: string;
    itag?: string;
    durationMs?: number | null;
}

interface RefusalBody {
    code?: string;
    message?: string;
}

/**
 * The station's audio-url resolver, as this plugin talks to it.
 *
 * `ytaudio/` turns a video id into a plain HTTPS URL the station fetches itself.
 * Nothing streams through it and nothing streams through here: what crosses this
 * boundary is an address and an expiry.
 *
 * Everything goes out through `host.fetch`, so the operator's declared resolver
 * address is the only one this can reach, and a resolver URL nobody configured
 * contributes no allowlist entry at all — which refuses the call rather than
 * letting it wander.
 */
export class ResolverClient {
    constructor(
        private readonly host: PluginHost,
        private readonly baseUrl: string,
    ) {}

    private url(path: string): string {
        return `${this.baseUrl.replace(/\/+$/, '')}${path}`;
    }

    /**
     * Hand the resolver the operator's session.
     *
     * Pushed rather than read from disk so there is exactly one place a cookie is
     * pasted: the plugin's settings card, where the station keeps it encrypted.
     * The resolver holds a cache of it that dies with its process, which is why
     * this is re-sent on demand rather than only once — see {@link resolve}.
     */
    async pushSession(cookie: string): Promise<boolean> {
        const host = this.host;
        try {
            const response = await host.fetch(this.url('/session'), {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ cookie }),
                timeoutMs: 10_000,
            });
            if (!response.ok) {
                const body = (await jsonBody<RefusalBody>(response).catch(() => undefined)) ?? {};
                host.logger.warn('youtube music: the audio resolver would not take the session', { reason: body.message ?? response.status });
                return false;
            }
            return true;
        } catch (error) {
            host.logger.warn('youtube music: could not reach the audio resolver', { reason: errorText(error) });
            return false;
        }
    }

    /**
     * Where this record's bytes are, or nothing.
     *
     * `undefined` is the SDK's "this station cannot serve this track": the host
     * reads it as unavailable, skips the item and holds nothing against the
     * plugin. Every reason a resolve fails is one of those — a resolver nobody
     * started, an account that cannot play, a record the upstream will not serve
     * — so none of them throws. A failure here must not be able to quarantine a
     * plugin whose catalog half is working perfectly.
     *
     * The one thing it retries is an absent session, because the resolver is a
     * separate process with its own lifetime: it can restart under a long-lived
     * plugin and come back empty, and the fix is simply to tell it again.
     */
    async resolve(trackId: string, cookie: string): Promise<ProviderStream | undefined> {
        const first = await this.attempt(trackId);
        if (first !== 'no-session') return first;

        if (!(await this.pushSession(cookie))) return undefined;
        const second = await this.attempt(trackId);
        return second === 'no-session' ? undefined : second;
    }

    private async attempt(trackId: string): Promise<ProviderStream | undefined | 'no-session'> {
        const host = this.host;
        let response: Response;
        try {
            response = await host.fetch(this.url('/resolve'), {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ videoId: trackId }),
                timeoutMs: RESOLVE_TIMEOUT_MS,
            });
        } catch (error) {
            // A resolver nobody started is the ordinary state of a station that
            // has not set the audio half up, not a fault to report.
            host.logger.debug('youtube music: the audio resolver did not answer', { reason: errorText(error) });
            return undefined;
        }

        if (response.ok) {
            const body = await jsonBody<ResolvedBody>(response).catch(() => undefined);
            if (!body?.url) return undefined;
            return {
                url: body.url,
                // The URL's OWN expiry, which the resolver reads off it. A URL
                // that outlives its upstream is an item that fails as it airs.
                ...(typeof body.expiresAt === 'number' ? { expiresAt: body.expiresAt } : {}),
                ...(body.mimeType ? { mimeType: body.mimeType } : {}),
            };
        }

        const body = (await jsonBody<RefusalBody>(response).catch(() => undefined)) ?? {};
        if (response.status === 401) return 'no-session';

        // Said at the level the reason deserves. A signed-in session served nothing
        // fetchable is the whole audio half failing and worth a warning; a record
        // the upstream will not serve is routine and is not. Keyed off the CODE
        // rather than the status, which this shares with other upstream failures.
        if (body.code === 'sabr')
            host.logger.warn(`youtube music: ${body.message ?? 'this session was served nothing playable'}`, { track: trackId });
        else host.logger.debug('youtube music: no audio for this record', { track: trackId, code: body.code ?? response.status });
        return undefined;
    }

    /** Whether the resolver is there at all, for the settings card. */
    async reachable(): Promise<{ ok: boolean; message: string }> {
        const host = this.host;
        try {
            const response = await host.fetch(this.url('/health'), { timeoutMs: 5_000 });
            if (!response.ok) return { ok: false, message: `The audio resolver at ${this.baseUrl} answered ${response.status}` };
            const body = await jsonBody<{ hasSession?: boolean }>(response).catch(() => undefined);
            return { ok: true, message: body?.hasSession ? 'The audio resolver has the session' : 'The audio resolver is up but has no session yet' };
        } catch (error) {
            // The ADDRESS, because that is the field the operator has to fix and the
            // host's own error names only the hostname when the mistake is a port.
            return { ok: false, message: `The audio resolver at ${this.baseUrl} did not answer: ${errorText(error)}` };
        }
    }
}

/** A configured resolver, or nothing when the operator has not named one. */
export function resolverFor(host: PluginHost, baseUrl: unknown): ResolverClient | undefined {
    if (typeof baseUrl !== 'string') return undefined;
    const trimmed = baseUrl.trim();
    if (!trimmed) return undefined;
    try {
        const parsed = new URL(trimmed);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return undefined;
    } catch {
        return undefined;
    }
    return new ResolverClient(host, trimmed);
}

/** Raised only where a caller genuinely cannot continue. Kept for symmetry with the rest of the plugin. */
export const resolverMisconfigured = (): PluginError => new PluginError('YouTube Music has no audio resolver configured').withCode('config');
