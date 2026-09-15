/**
 * Where an `artworkUrl` is fetched from.
 *
 * The station answers one of two shapes: an absolute URL at the provider's own CDN, for art nothing
 * has cached yet, or a path relative to the API ROOT (`art/<uuid>`) once it holds its own copy. The
 * API knows nothing about the prefix its edge adds, so resolving the relative form is the client's job,
 * and this is the console's `artSrc` doing it.
 */
export function resolveArtworkUrl(apiBase: string, artworkUrl: string | undefined): string | undefined {
    if (artworkUrl === undefined || artworkUrl.trim() === '') return undefined;
    if (/^https?:\/\//i.test(artworkUrl)) return artworkUrl;
    return `${apiBase}/${artworkUrl.replace(/^\/+/, '')}`;
}

/**
 * The image types a key can draw: the still ones Elgato lists for `setImage`. GIF is left out because
 * the app draws no animation, and anything else (AVIF, say) because a cover the app cannot decode
 * would draw as nothing at all rather than as the placeholder.
 */
const DRAWABLE = new Set(['image/jpeg', 'image/png', 'image/webp']);

export interface ArtworkOptions {
    fetch?: typeof fetch;
    userAgent: string;
    /** Covers larger than this are drawn as the placeholder rather than sent to a 72-pixel key. */
    maxBytes?: number;
    timeoutMs?: number;
    /** How many covers are remembered, which is a few records either way of the one on air. */
    capacity?: number;
}

/**
 * Covers as data URIs, fetched once each and remembered.
 *
 * A key shows one cover for minutes and redraws it every few seconds as the bar moves, so a cover is
 * fetched when its record starts and never again while it plays. A cover that could not be had is
 * remembered as such for the same reason: a provider that answers 404 is asked once, not on every
 * redraw. Requests go out with the plugin's User-Agent and WITHOUT the station's key, since the
 * station serves its own covers to anybody and a provider's CDN must never see the key.
 */
export class ArtworkCache {
    private readonly fetch: typeof fetch;
    private readonly options: Required<Omit<ArtworkOptions, 'fetch'>>;
    private readonly covers = new Map<string, string | undefined>();
    private readonly pending = new Map<string, Promise<string | undefined>>();

    constructor(options: ArtworkOptions) {
        this.fetch = options.fetch ?? globalThis.fetch;
        this.options = { maxBytes: 1024 * 1024, timeoutMs: 10_000, capacity: 8, ...options };
    }

    /** The cover if it has been fetched: a data URI, `undefined` for one that could not be had, or absent if never asked. */
    peek(url: string): { cover: string | undefined } | undefined {
        return this.covers.has(url) ? { cover: this.covers.get(url) } : undefined;
    }

    /** The cover, fetching it the first time and sharing one request between everybody who asks meanwhile. */
    async load(url: string): Promise<string | undefined> {
        const known = this.peek(url);
        if (known) return known.cover;
        const inFlight = this.pending.get(url);
        if (inFlight) return inFlight;

        const request = this.download(url).then(cover => {
            this.pending.delete(url);
            this.remember(url, cover);
            return cover;
        });
        this.pending.set(url, request);
        return request;
    }

    private async download(url: string): Promise<string | undefined> {
        try {
            const response = await this.fetch(url, {
                headers: { 'User-Agent': this.options.userAgent },
                signal: AbortSignal.timeout(this.options.timeoutMs),
            });
            if (!response.ok) return undefined;
            const type = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() ?? '';
            if (!DRAWABLE.has(type)) return undefined;
            const declared = Number(response.headers.get('content-length'));
            if (Number.isFinite(declared) && declared > this.options.maxBytes) return undefined;
            const bytes = Buffer.from(await response.arrayBuffer());
            if (bytes.byteLength > this.options.maxBytes) return undefined;
            return `data:${type};base64,${bytes.toString('base64')}`;
        } catch {
            return undefined;
        }
    }

    private remember(url: string, cover: string | undefined): void {
        this.covers.delete(url);
        this.covers.set(url, cover);
        while (this.covers.size > this.options.capacity) {
            const oldest = this.covers.keys().next().value;
            if (oldest === undefined) break;
            this.covers.delete(oldest);
        }
    }
}
