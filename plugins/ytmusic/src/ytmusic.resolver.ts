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
     * Where this record's bytes are, or nothing. Asked SIGNED OUT, with the video id and nothing else.
     *
     * The operator's cookie never crosses to the resolver, and that is the design rather than an
     * omission. Measured 2026-09-19 through yt-dlp on the operator's own account: signed in, a record
     * offers no fetchable format without a JS runtime, and with one every format it lists answers 403
     * to a session that has no proof-of-origin token. Signed out, the same records resolve and play.
     * So the cookie stays in the plugin for what needs it (search, the library, playlists) and the
     * audio path never sees it. The price is stated in the README: a record that needs an account to
     * play, age-gated or subscriber-only, will not play from here.
     *
     * `undefined` is the SDK's "this station cannot serve this track": the host reads it as
     * unavailable, skips the item and holds nothing against the plugin. Every reason a resolve fails is
     * one of those (a resolver nobody started, a record the upstream will not serve), so none of them
     * throws. A failure here must not be able to quarantine a plugin whose catalog half is working.
     */
    async resolve(trackId: string): Promise<ProviderStream | undefined> {
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
            // A resolver nobody started is the ordinary state of a station that has not set the audio
            // half up, not a fault to report.
            host.logger.debug('youtube music: the audio resolver did not answer', { reason: errorText(error) });
            return undefined;
        }

        if (response.ok) {
            const body = await jsonBody<ResolvedBody>(response).catch(() => undefined);
            if (!body?.url) return undefined;
            return {
                url: body.url,
                // The URL's OWN expiry, which the resolver reads off it. A URL that outlives its upstream
                // is an item that fails as it airs.
                ...(typeof body.expiresAt === 'number' ? { expiresAt: body.expiresAt } : {}),
                ...(body.mimeType ? { mimeType: body.mimeType } : {}),
            };
        }

        const body = (await jsonBody<RefusalBody>(response).catch(() => undefined)) ?? {};
        host.logger.debug('youtube music: no audio for this record', { track: trackId, code: body.code ?? response.status });
        return undefined;
    }

    /** Whether the resolver is there at all, for the settings card. */
    async reachable(): Promise<{ ok: boolean; message: string }> {
        const host = this.host;
        try {
            const response = await host.fetch(this.url('/health'), { timeoutMs: 5_000 });
            if (!response.ok) return { ok: false, message: `The audio resolver at ${this.baseUrl} answered ${response.status}` };
            return { ok: true, message: 'The audio resolver is up' };
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
