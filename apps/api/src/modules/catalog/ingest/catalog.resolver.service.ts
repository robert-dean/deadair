import { Injectable } from 'injectkit';
import { Kysely } from 'kysely';
import type { ProviderTrack } from '@deadair/plugin-sdk';
import { DB } from '../../data/db.js';
import { CatalogResolverRepository, type TrackSourceOrigin } from './catalog.resolver.repository.js';
import type { SweepOutcome } from './catalog.sweep.guard.js';
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
     * connection and an open snapshot for its whole duration. That is still
     * true of the walk, which runs in a job scope with no transaction to join.
     *
     * ## It JOINS an open transaction rather than opening a second one
     *
     * Kysely refuses `.transaction()` on a `Transaction` outright, and on every
     * non-exempt request the injected `Kysely` IS one: `auditContextMiddleware`
     * opens a transaction per request and overrides the scoped `Kysely<DB>`
     * with it. So opening unconditionally here threw for every caller reached
     * from an HTTP handler rather than from a job.
     *
     * That was live, and it was silent. Airing a published chart is the one
     * broadcast source that has to INGEST — a chart names records where a
     * playlist names copies — so `PickResolver.discover` calls this inside the
     * request transaction. Every lookup threw "calling the transaction method
     * for a Transaction is not supported", `discover` caught it and downgraded
     * it to a warning, and a hundred-entry chart went on air with the eight
     * records the library already held.
     *
     * Joining keeps what the transaction is here for: the sequence still
     * commits whole or not at all. What changes when there IS an ambient one is
     * that it commits with the caller's work instead of on its own, and a
     * failure here takes the caller's transaction down too. Both are the right
     * way round — a request that could not finish should leave no track behind,
     * and one that succeeded should not have its ingest rolled back separately.
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

        const ingest = async (executor: Kysely<DB>): Promise<IngestResult> => {
            const resolver = this.resolver.withTransaction(executor);
            const artistId = await resolver.resolveArtist(artistName);
            // The track's year is the album's here, and that is the provider's own claim rather than
            // an inference: what a provider dates is the RELEASE an item sits on, so a row's year and
            // its album's year are the same fact arriving once. Both are filled only when blank, so
            // an album already dated by enrichment is left alone.
            const albumId = track.album ? await resolver.resolveAlbum(artistId, track.album, track.artworkUrl, track.year) : undefined;
            const resolved = await resolver.resolveTrack(artistId, albumId, track);
            await resolver.upsertTrackSource(resolved.id, pluginId, track, origin);
            return { status: 'ingested', trackId: resolved.id, created: resolved.created };
        };

        return this.db.isTransaction ? await ingest(this.db) : await this.db.transaction().execute(ingest);
    }

    /**
     * Marks every binding this plugin no longer offers, having just been told
     * everything it does.
     *
     * The other half of reconciling one provider against the catalog, which is
     * why it lives beside the ingest rather than being reached for separately:
     * it is only meaningful in terms of what a completed walk saw.
     *
     * @param maxPercent - Most of this plugin's live `sync` bindings one sweep
     *   may retire, which the caller resolves from the setting. The sweep can
     *   decline; see {@link SweepOutcome} and `catalog.sweep.guard.ts`.
     */
    async markMissing(pluginId: string, seenExternalIds: readonly string[], maxPercent: number): Promise<SweepOutcome> {
        return this.resolver.markMissingTrackSources(pluginId, seenExternalIds, maxPercent);
    }
}
