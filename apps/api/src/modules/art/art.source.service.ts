import { Injectable } from 'injectkit';
import { httpError } from '@maroonedsoftware/errors';
import { ArtCacheService } from './art.cache.service.js';
import { ArtRepository, type ArtAsset } from './art.repository.js';
import type { ArtResponse } from './art.service.js';
import { openSourceToken } from './art.source.token.js';
import { ART_SERVED_TYPES, ArtStore } from './art.store.js';

/**
 * How long a browser may keep a cover served through the proxy. The hour `ArtService` gives a cached
 * cover, for the same reason: the token names one upstream URL for good, and the ETag is the checksum
 * of whatever bytes the station holds for it.
 */
const CACHE_CONTROL = 'public, max-age=3600';

/**
 * Fetches in flight, by upstream URL, across every request in this process. Module state because the
 * service is scoped (one per request) and the point is that two requests share one fetch.
 */
const inFlight = new Map<string, Promise<ArtAsset | undefined>>();

/**
 * `GET /art/source/{token}`: a cover the station has not cached yet, served as the station's own.
 *
 * Every read reports an uncached cover as `art/source/<token>` (see `art.source.token.ts` for why the
 * provider's URL may never go out). This is what answers that path. It opens the token, serves the
 * bytes the store already holds for that URL, and otherwise fetches them into the store first through
 * `ArtCacheService.cache`, the sweep's own fetch. So the private-address refusal, the size caps, the
 * timeout and the failure record all apply unchanged, and the next read of the same cover reports the
 * plain `art/<id>` path.
 *
 * **Every failure is a 404**: a token this station did not mint, a URL whose fetch failed, one whose
 * last failure is still inside its backoff, bytes gone from disk. The console draws its placeholder
 * for a 404, and an answer that varied would tell a caller something about the upstream. A recorded
 * failure is not retried until `next_attempt_at`, so a page of dead covers polled by every listener
 * costs no fetches at all. Concurrent requests for one cover share one fetch.
 */
@Injectable()
export class ArtSourceService {
    constructor(
        private readonly artRepository: ArtRepository,
        private readonly artCache: ArtCacheService,
        private readonly artStore: ArtStore,
    ) {}

    async getSourceArt(token: string): Promise<ArtResponse> {
        const sourceUrl = openSourceToken(token);
        if (sourceUrl === undefined) throw notHere();

        const asset = await this.held(sourceUrl);
        if (asset?.checksum === undefined || asset.ext === undefined) throw notHere();

        const bytes = await this.artStore.read(asset.checksum, asset.ext);
        if (bytes === undefined) throw notHere();

        return {
            contentType: ART_SERVED_TYPES[asset.ext],
            body: bytes,
            headers: { cacheControl: CACHE_CONTROL, etag: `"${asset.checksum}"` },
        };
    }

    /** The same bytes under a filename, for a player that decides by the URL. The name is never read; see `ArtService.getArtFile`. */
    async getSourceArtFile(token: string, _filename: string): Promise<ArtResponse> {
        return this.getSourceArt(token);
    }

    /** What the store holds for this URL, fetching it first when it may. Single-flight per URL. */
    private async held(sourceUrl: string): Promise<ArtAsset | undefined> {
        const state = await this.artRepository.findSourceState(sourceUrl);
        if (state?.asset.checksum !== undefined) return state.asset;
        if (state?.backingOff === true) return undefined;

        const running = inFlight.get(sourceUrl);
        if (running !== undefined) return running;

        const fetch = this.artCache
            .cache(sourceUrl)
            .then(async outcome => (outcome.cached ? this.artRepository.findById(outcome.id) : undefined))
            // `cache` records its own failures rather than throwing; anything that still escapes (the
            // store could not record it) is the same 404 to the caller, never a 500.
            .catch(() => undefined)
            .finally(() => inFlight.delete(sourceUrl));
        inFlight.set(sourceUrl, fetch);
        return fetch;
    }
}

const notHere = () => httpError(404).withDetails({ message: 'no such cover' });
