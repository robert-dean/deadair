import { Injectable } from 'injectkit';
import { DateTime } from 'luxon';
import { httpError } from '@maroonedsoftware/errors';
import { parseAndValidate } from '@maroonedsoftware/zod';
import { AlbumEnrichmentDetail, ArtistEnrichmentDetail, TrackEnrichmentDetail } from '#src/modules/catalog/types/catalog.types.js';
import {
    mergeAlbumEnrichment,
    mergeArtistEnrichment,
    mergeEnrichment,
    sanitizeAlbumEnrichment,
    sanitizeArtistEnrichment,
    sanitizeEnrichment,
    withoutPerProviderFields,
} from './enrichment.merge.js';
import { EnrichmentRepository, type StoredProviderPayload } from './enrichment.repository.js';
import { EnrichmentService } from './enrichment.service.js';

/**
 * One stored payload once it has been sanitized, before it is shaped for the wire.
 *
 * The timestamps stay `DateTime`: the contract's `datetime` is a luxon instant on
 * this side of the wire and an ISO string on the client's, so there is nothing to
 * convert here.
 */
interface ReadSource<T> {
    provider: string;
    providerRef?: string;
    fetchedAt: DateTime;
    expiresAt?: DateTime;
    stale: boolean;
    found: boolean;
    data: T;
}

/**
 * Reading back what the enrichment walk stored.
 *
 * Separate from {@link EnrichmentService} because the two have nothing in
 * common but a table: that one spends rate-limited requests against upstreams
 * and writes, this one answers a request from rows that already exist. Keeping
 * them apart is what lets the console read a track's enrichment without any
 * risk of a page view triggering a fan-out.
 *
 * What it does share is the interpretation. Payloads are re-sanitized and
 * re-merged with the same functions the write path used, in the same live
 * plugin-priority order, so the console cannot end up telling a different story
 * from the one promotion told the canonical columns.
 */
@Injectable()
export class EnrichmentReadService {
    constructor(
        private readonly enrichmentRepository: EnrichmentRepository,
        private readonly enrichmentService: EnrichmentService,
    ) {}

    /** @throws 404 when no such track exists, and equally when it was merged into another. */
    async getTrackEnrichment(id: string): Promise<TrackEnrichmentDetail> {
        const stored = await this.enrichmentRepository.findTrackEnrichment(id);
        if (stored === undefined) throw httpError(404).withDetails({ message: `track "${id}" is not in the catalog` });

        const sources = this.read(stored, this.enrichmentService.providerIds(), sanitizeEnrichment);
        const merged = mergeEnrichment(sources.filter(source => source.found).map(source => source.data));

        return parseAndValidate({ trackId: id, merged, sources }, TrackEnrichmentDetail);
    }

    /** @throws 404 when no such artist exists, and equally when they were merged into another. */
    async getArtistEnrichment(id: string): Promise<ArtistEnrichmentDetail> {
        const stored = await this.enrichmentRepository.findArtistEnrichment(id);
        if (stored === undefined) throw httpError(404).withDetails({ message: `artist "${id}" is not in the catalog` });

        const sources = this.read(stored, this.enrichmentService.artistProviderIds(), sanitizeArtistEnrichment);
        const merged = mergeArtistEnrichment(sources.filter(source => source.found).map(source => source.data));

        return parseAndValidate({ artistId: id, merged, sources }, ArtistEnrichmentDetail);
    }

    /** @throws 404 when no such album exists, and equally when it was merged into another. */
    async getAlbumEnrichment(id: string): Promise<AlbumEnrichmentDetail> {
        const stored = await this.enrichmentRepository.findAlbumEnrichment(id);
        if (stored === undefined) throw httpError(404).withDetails({ message: `album "${id}" is not in the catalog` });

        const sources = this.read(stored, this.enrichmentService.albumProviderIds(), sanitizeAlbumEnrichment);
        const merged = mergeAlbumEnrichment(sources.filter(source => source.found).map(source => source.data));

        return parseAndValidate({ albumId: id, merged, sources }, AlbumEnrichmentDetail);
    }

    /**
     * Stored rows to wire sources, in the order the merge has to see them.
     *
     * Sanitizing again on the way out is not defensive theatre. `data` is a
     * jsonb column with no constraint on it, the write path's sanitizer is the
     * only thing that has ever checked it, and a row edited by hand or by some
     * later writer would otherwise reach a browser as a link the console
     * renders for a human to click.
     *
     * Ordering is the live plugin priority, and a provider that is no longer
     * installed sorts last rather than being dropped. Its payload is still what
     * the station knows about this track, and the station's own columns were
     * promoted from it; hiding it would make the console disagree with them.
     * What it does not get is a say over a running provider.
     *
     * The per-provider fields come OFF the payload here. `providerRef` is
     * stored twice on purpose — in the payload because that is what the plugin
     * said, and in its own column because something queries it — and the
     * contract carries it on the source rather than inside `data`. See
     * {@link withoutPerProviderFields}.
     */
    private read<T extends object>(stored: StoredProviderPayload[], order: string[], sanitize: (value: unknown) => T): ReadSource<T>[] {
        const rank = new Map(order.map((provider, index) => [provider, index]));
        const now = DateTime.now();

        return stored
            .map(payload => {
                const data = withoutPerProviderFields(sanitize(payload.data));
                return {
                    provider: payload.provider,
                    providerRef: payload.providerRef,
                    fetchedAt: payload.fetchedAt,
                    expiresAt: payload.expiresAt,
                    // A row past its TTL is still the best answer there is. It
                    // is flagged rather than hidden, because "MusicBrainz said
                    // this in May and is due to be asked again" is a different
                    // thing from having nothing.
                    stale: payload.expiresAt !== undefined && payload.expiresAt <= now,
                    // An empty payload is a recorded miss: the provider was
                    // asked and had nothing. Not a failure, and not an empty
                    // card for the console to puzzle over.
                    found: Object.keys(data).length > 0,
                    data,
                };
            })
            .sort(
                (left, right) =>
                    (rank.get(left.provider) ?? Number.MAX_SAFE_INTEGER) - (rank.get(right.provider) ?? Number.MAX_SAFE_INTEGER) ||
                    left.provider.localeCompare(right.provider),
            );
    }
}
