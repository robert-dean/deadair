import { Injectable } from 'injectkit';
import { httpError } from '@maroonedsoftware/errors';
import { ArtRepository } from './art.repository.js';
import { ART_SERVED_TYPES, ArtStore, type ArtContentType } from './art.store.js';
import { isBreakArtKey } from './break.art.js';

/**
 * How long a browser may reuse a cached image before asking again.
 *
 * Not `immutable`, because the URL is the asset's id rather than its content hash: the same id can
 * come back with different bytes if its source URL is ever refetched. An hour plus the ETag makes
 * that a headers-only revalidation once the hour is up, which the conditional-GET middleware
 * answers with a 304.
 */
const CACHE_CONTROL = 'public, max-age=3600';

/**
 * The same thing for a picture somebody can REPLACE: store it, but ask first.
 *
 * The hour above is right for a cached cover, whose bytes change only when a background sweep
 * refetches them and where nobody is waiting on the result. A break picture changes because an
 * operator pressed Upload and is looking at the screen, and it is the same URL before and after —
 * that stability is the whole point of keying the row rather than the bytes — so an hour would be an
 * hour of the old picture on every player and in the console, which reads as the upload not having
 * worked.
 *
 * `no-cache` is not `no-store`: the bytes are kept and reused, they are just revalidated first, and
 * the conditional-GET middleware answers that with a headers-only 304 off the ETag below. The cost,
 * using this repository's own measurement of a NAD M10 V2 (`docs/internals/playout.md`), is three
 * conditional requests per break on the operator's own network.
 */
const REPLACEABLE_CACHE_CONTROL = 'no-cache';

/**
 * What the art route hands the generated router.
 *
 * `contentType` is what the operation's declared mimes are chosen from, so a png is served as a png
 * rather than as `application/octet-stream` for a browser to sniff. That it worked at all before
 * was down to `<img>` being forgiving; it is also what stopped this API sending
 * `X-Content-Type-Options: nosniff`.
 */
export interface ArtResponse {
    contentType: ArtContentType;
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

        return {
            contentType: ART_SERVED_TYPES[asset.ext],
            body: bytes,
            headers: {
                cacheControl: isBreakArtKey(asset.sourceUrl) ? REPLACEABLE_CACHE_CONTROL : CACHE_CONTROL,
                etag: `"${asset.checksum}"`,
            },
        };
    }

    /**
     * The same bytes, under a filename the caller chose.
     *
     * The filename is never read. It exists because a client can decide whether a URL is worth
     * fetching by looking at the URL: a BluOS player handed an artwork link in the stream's ICY
     * metadata fetches one ending in `.jpg` and does not request one ending in an id at all,
     * which is measurable as zero requests rather than as a failure. So `cachedOrUpstream` in
     * `catalog.art.ts` mints `art/<id>/cover.<ext>` and this answers it.
     *
     * The extension in that name is what the store recorded for the asset, so it is normally
     * true — but it is not what decides the response, because the asset's own content type
     * already does and the two cannot be allowed to disagree. A request for `cover.png` against a
     * JPEG gets the JPEG and an `image/jpeg` header, which is the same answer {@link getArt}
     * gives.
     */
    async getArtFile(id: string, _filename: string): Promise<ArtResponse> {
        return this.getArt(id);
    }
}
