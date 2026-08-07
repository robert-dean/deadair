import { Injectable } from 'injectkit';
import { httpError } from '@maroonedsoftware/errors';
import { ArtRepository } from './art.repository.js';
import { ArtStore } from './art.store.js';

/**
 * How long a browser may reuse a cached image before asking again.
 *
 * Not `immutable`, because the URL is the asset's id rather than its content hash: the same id can
 * come back with different bytes if its source URL is ever refetched. An hour plus the ETag makes
 * that a headers-only revalidation once the hour is up, which the conditional-GET middleware
 * answers with a 304.
 */
const CACHE_CONTROL = 'public, max-age=3600';

/** What the art route hands the generated router. */
export interface ArtResponse {
    body: Buffer;
    headers: { cacheControl: string; etag: string };
}

@Injectable()
export class ArtService {
    constructor(
        private readonly artRepository: ArtRepository,
        private readonly artStore: ArtStore,
    ) {}

    /**
     * The bytes of one cached image.
     *
     * @throws 404 for an id nobody cached, for a row whose fetches all failed (it has no bytes to
     * serve and never had any), and for a row whose file has gone missing under it. All three are
     * the same answer to the browser: there is no art here. The catalog keeps reporting the
     * upstream URL until a fetch succeeds, so a 404 here is not a broken page.
     */
    async getArt(id: string): Promise<ArtResponse> {
        const asset = await this.artRepository.findById(id);
        if (asset?.checksum === undefined || asset.ext === undefined) {
            throw httpError(404).withDetails({ message: `art "${id}" is not cached` });
        }

        const bytes = await this.artStore.read(asset.checksum, asset.ext);
        if (bytes === undefined) throw httpError(404).withDetails({ message: `art "${id}" has no file` });

        return { body: bytes, headers: { cacheControl: CACHE_CONTROL, etag: `"${asset.checksum}"` } };
    }
}
