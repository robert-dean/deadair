import { Injectable } from 'injectkit';
import { Logger } from '@maroonedsoftware/logger';
import { ArtRepository } from './art.repository.js';
import { ART_CONTENT_TYPES, ArtExtension, ArtStore } from './art.store.js';
import { errorText } from '#modules/shared/error.text.js';

/**
 * How long one image may take.
 *
 * The same ten seconds a MusicBrainz request gets. Cover Art Archive redirects to archive.org and
 * archive.org can be slow, but a cover is not worth holding a sweep open for.
 */
const FETCH_TIMEOUT_MS = 10_000;

/**
 * The most bytes one image may be.
 *
 * Enforced while reading rather than from `content-length`, which is absent on a chunked response
 * and is in any case the upstream's claim rather than a fact. Cover Art Archive's `front-500` is
 * tens of kilobytes; the cap is here to stop a mistake (a full-size gatefold scan, an HTML error
 * page served as an image) rather than to be a tight budget.
 */
const MAX_BYTES = 5 * 1024 * 1024;

/** First retry after five minutes, doubling per attempt up to a day. */
const BASE_RETRY_MS = 5 * 60 * 1000;
const MAX_RETRY_MS = 24 * 60 * 60 * 1000;

/** What the caller learns about one URL. `cached` means bytes are now on disk under `id`. */
export type ArtCacheOutcome = { cached: true; id: string } | { cached: false; reason: string };

/** The extension for a response's content type, or undefined if it is not art we serve. */
function extensionFor(contentType: string | null): ArtExtension | undefined {
    if (contentType === null) return undefined;

    // `image/jpeg; charset=binary` and friends: the parameters are noise here.
    const mime = contentType.split(';')[0]?.trim().toLowerCase() ?? '';
    return ART_CONTENT_TYPES[mime];
}

@Injectable()
export class ArtCacheService {
    constructor(
        private readonly artRepository: ArtRepository,
        private readonly artStore: ArtStore,
        private readonly logger: Logger,
    ) {}

    /**
     * Fetches one upstream art URL into the local store.
     *
     * Every failure is recorded rather than thrown: a dead cover is an ordinary fact about the
     * catalog, not an error the sweep should stop for, and the row is what makes the next pass back
     * off instead of asking again immediately.
     *
     * @param signal - The sweep's own cancellation, combined with this fetch's timeout. Aborting the
     *   job aborts the request in flight rather than waiting out the ten seconds.
     */
    async cache(sourceUrl: string, signal?: AbortSignal): Promise<ArtCacheOutcome> {
        try {
            const bytes = await this.download(sourceUrl, signal);
            const checksum = await this.artStore.write(bytes.body, bytes.ext);
            const asset = await this.artRepository.recordSuccess(sourceUrl, {
                checksum,
                ext: bytes.ext,
                contentType: bytes.contentType,
                byteSize: bytes.body.byteLength,
            });

            return { cached: true, id: asset.id };
        } catch (error) {
            const reason = errorText(error);
            await this.artRepository.recordFailure(sourceUrl, reason, BASE_RETRY_MS, MAX_RETRY_MS);
            this.logger.debug('could not cache art', { sourceUrl, reason });

            return { cached: false, reason };
        }
    }

    /**
     * One image off the wire.
     *
     * `http(s)` only: these URLs come from plugins, which are trusted in-process code but are also
     * the least reviewed code in the tree, and `file:` would turn a bad mapping into a local file
     * read. This is a guard against a mistake, not a sandbox — see docs/decisions/plugin-isolation.
     */
    private async download(sourceUrl: string, signal?: AbortSignal): Promise<{ body: Buffer; ext: ArtExtension; contentType: string }> {
        const url = new URL(sourceUrl);
        if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error(`refusing to fetch ${url.protocol}`);

        const timeout = AbortSignal.timeout(FETCH_TIMEOUT_MS);
        const response = await fetch(url, {
            redirect: 'follow',
            signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
        });

        if (!response.ok) throw new Error(`upstream answered ${response.status}`);

        const contentType = response.headers.get('content-type');
        const ext = extensionFor(contentType);
        if (ext === undefined) throw new Error(`not an image: ${contentType ?? 'no content type'}`);

        return { body: await this.readCapped(response), ext, contentType: contentType!.split(';')[0]!.trim().toLowerCase() };
    }

    /** The body, refusing anything over {@link MAX_BYTES} as it arrives rather than after it lands. */
    private async readCapped(response: Response): Promise<Buffer> {
        if (response.body === null) throw new Error('upstream sent no body');

        const chunks: Buffer[] = [];
        let total = 0;

        for await (const chunk of response.body) {
            const buffer = Buffer.from(chunk as Uint8Array);
            total += buffer.byteLength;
            if (total > MAX_BYTES) {
                await response.body.cancel().catch(() => undefined);
                throw new Error(`image is larger than ${MAX_BYTES} bytes`);
            }
            chunks.push(buffer);
        }

        if (total === 0) throw new Error('upstream sent an empty body');

        return Buffer.concat(chunks);
    }
}
