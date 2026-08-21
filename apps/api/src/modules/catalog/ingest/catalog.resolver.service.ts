import { Injectable } from 'injectkit';
import { Kysely } from 'kysely';
import type { ProviderTrack } from '@deadair/plugin-sdk';
import { DB } from '../../data/db.js';
import { CatalogResolverRepository, type TrackSourceOrigin } from './catalog.resolver.repository.js';
import { normalizeKey } from '../catalog.keys.js';

/** Why an item could not become a catalog row. */
export type IngestSkipReason =
    /**
     * The provider credited nobody, or credited a name that normalizes to
     * nothing. `tracks.artist_id` is NOT NULL and `artists.artist_key` is
     * `not null unique`, so there is no row to attach this to and an empty key
     * would collapse every such item onto one shared artist.
     */
    'no-artist';

export type IngestResult = { status: 'ingested'; trackId: string; created: boolean } | { status: 'skipped'; reason: IngestSkipReason };

/**
 * The ingest use case: everything that has to be true, and has to happen
 * together, for one provider item to become part of the catalog.
 *
 * Separate from {@link CatalogResolverRepository} because the two answer
 * different questions. The repository knows how to find or write one row; this
 * knows what a complete ingest *is* — which items are admissible, in what order
 * the rows are resolved, and that the whole sequence commits or none of it
 * does. Keeping the transaction here also matches the rest of the codebase,
 * where repositories run inside a transaction someone else opened rather than
 * opening their own.
 */
@Injectable()
export class CatalogResolverService {
    constructor(
        private readonly db: Kysely<DB>,
        private readonly resolver: CatalogResolverRepository,
    ) {}

    /**
     * Resolves one provider item to a canonical track and records the binding,
     * as a single transaction.
     *
     * Atomic because the halves are worthless apart: a canonical track with no
     * binding is invisible to playout and would be re-created as a duplicate on
     * the next run, and a binding pointing at a track that was rolled back
     * violates its foreign key.
     *
     * One short transaction per item, rather than one long one per run, is what
     * lets the caller be a long, network-bound walk without holding a pool
     * connection and an open snapshot for its whole duration.
     *
     * @param pluginId - Manifest id of the providing plugin.
     * @param track - The item as the provider described it.
     * @param origin - How this copy was found. The walk leaves it at `sync`; a
     *   lookup for a record something chose passes `discovered`, which is what
     *   exempts the binding from a sweep that could never have seen it.
     * @returns The canonical track id, or why the item could not become one.
     */
    async ingestTrack(pluginId: string, track: ProviderTrack, origin: TrackSourceOrigin = 'sync'): Promise<IngestResult> {
        const artistName = track.artists[0];
        if (!artistName || normalizeKey(artistName).length === 0) {
            return { status: 'skipped', reason: 'no-artist' };
        }

        return this.db.transaction().execute(async trx => {
            const resolver = this.resolver.withTransaction(trx);
            const artistId = await resolver.resolveArtist(artistName);
            // The track's year is the album's here, and that is the provider's own claim rather than
            // an inference: what a provider dates is the RELEASE an item sits on, so a row's year and
            // its album's year are the same fact arriving once. Both are filled only when blank, so
            // an album already dated by enrichment is left alone.
            const albumId = track.album ? await resolver.resolveAlbum(artistId, track.album, track.artworkUrl, track.year) : undefined;
            const resolved = await resolver.resolveTrack(artistId, albumId, track);
            await resolver.upsertTrackSource(resolved.id, pluginId, track, origin);
            return { status: 'ingested', trackId: resolved.id, created: resolved.created };
        });
    }

    /**
     * Marks every binding this plugin no longer offers, having just been told
     * everything it does.
     *
     * The other half of reconciling one provider against the catalog, which is
     * why it lives beside the ingest rather than being reached for separately:
     * it is only meaningful in terms of what a completed walk saw. Single
     * statement, so it needs no transaction of its own.
     *
     * @returns How many bindings were newly marked missing.
     */
    async markMissing(pluginId: string, seenExternalIds: readonly string[]): Promise<number> {
        return this.resolver.markMissingTrackSources(pluginId, seenExternalIds);
    }
}
