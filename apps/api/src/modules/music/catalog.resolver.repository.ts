import { Injectable } from 'injectkit';
import { Kysely, sql } from 'kysely';
import { Logger } from '@maroonedsoftware/logger';
import type { ProviderTrack } from '@deadair/plugin-sdk';
import { DataRepository } from '../data/data.repository.js';
import { DB } from '../data/db.js';
import { normalizeKey } from './music.keys.js';

/**
 * How far two durations may differ and still be taken for the same recording.
 * Wide enough to absorb a fade trimmed differently between a rip and a
 * streaming master, narrow enough that a radio edit does not match its album
 * version.
 */
const DURATION_TOLERANCE_MS = 3_000;

/**
 * Merge chains are one or two hops in practice. The bound is not a real limit,
 * it is a guarantee that a cycle written by a future merge tool cannot spin a
 * job forever.
 */
const MAX_MERGE_HOPS = 8;

/** Canonical tables carrying `merged_into_id`. */
type MergeableTable = 'deadair.artists' | 'deadair.albums' | 'deadair.tracks';

/**
 * A nullable column as it actually arrives.
 *
 * `db.ts` types these `T | null`, but the plugins on the runtime `Kysely`
 * hand back `undefined` for SQL NULL, so a `=== null` test on a read row is
 * always false. Reads below compare with `== null` (or use this type) rather
 * than trusting the generated signature. Writes are unaffected: `null` is what
 * pg wants and what those columns are declared to take.
 */
type Nullable<T> = T | null | undefined;

/** Why an item could not become a catalog row. */
export type IngestSkipReason =
    /** The provider credited nobody, and `tracks.artist_id` is NOT NULL. */
    | 'no-artist'
    /** Neither title nor artist survived key normalization, so nothing could be matched or displayed. */
    | 'unnamed';

export type IngestResult = { status: 'ingested'; trackId: string; created: boolean } | { status: 'skipped'; reason: IngestSkipReason };

/** What a resolved track needs, independent of which provider described it. */
export interface TrackIdentity {
    title: string;
    /** Ordered, primary artist first. */
    artists: string[];
    album?: string;
    durationMs?: number;
    isrc?: string;
    artworkUrl?: string;
}

/** A canonical track competing to be the match for an incoming item. */
export interface TrackCandidate {
    id: string;
    durationMs: Nullable<number>;
}

/**
 * Which of several same-artist, same-title tracks an incoming item is.
 *
 * The ambiguity is real and permanent: an album version and a single edit
 * legitimately share both keys. Duration is the only evidence available at this
 * rung, so the closest match within {@link DURATION_TOLERANCE_MS} wins.
 *
 * Falling back to the first candidate matters more than it looks. The caller
 * orders by age, so "oldest" is a stable answer: the same item resolves to the
 * same row on every run, instead of drifting between duplicates and scattering
 * one recording's bindings across them.
 *
 * Pure, and separate from the query, because this is the judgement call in the
 * whole resolver — the one place a wrong answer silently attaches one track's
 * provider ids to another.
 *
 * @param candidates - Matching tracks, oldest first.
 * @param durationMs - The incoming item's duration, when the provider gave one.
 * @returns The chosen candidate and which evidence chose it, or `undefined` if
 *   there were no candidates at all.
 */
export const chooseTrackCandidate = (
    candidates: readonly TrackCandidate[],
    durationMs: number | undefined,
): { id: string; by: 'only' | 'duration' | 'age' } | undefined => {
    if (candidates.length === 0) return undefined;
    if (candidates.length === 1) return { id: candidates[0]!.id, by: 'only' };

    if (durationMs !== undefined) {
        let closest: TrackCandidate | undefined;
        let closestDelta = Number.POSITIVE_INFINITY;
        for (const candidate of candidates) {
            // `== null` deliberately: a track with no recorded duration reads
            // back as `undefined`, and arithmetic on it would quietly produce
            // NaN comparisons that are false for the wrong reason.
            if (candidate.durationMs == null) continue;
            const delta = Math.abs(candidate.durationMs - durationMs);
            // Strictly less than, so an exact tie keeps the older row and the
            // choice stays stable.
            if (delta <= DURATION_TOLERANCE_MS && delta < closestDelta) {
                closest = candidate;
                closestDelta = delta;
            }
        }
        if (closest) return { id: closest.id, by: 'duration' };
    }

    return { id: candidates[0]!.id, by: 'age' };
};

/**
 * The ingest half of the catalog schema: turning an item some provider
 * described into the canonical row it belongs to, plus the binding that records
 * which provider can serve it.
 *
 * The resolution order is the one stated at the top of `0004_music.sql` — mbid,
 * then the isrc claimed by an existing binding, then the fuzzy `*_key` columns.
 * The mbid rung is skipped here because no music provider hands one out; it is
 * enrichment's to fill, and this must degrade without it rather than wait.
 *
 * Two rules run through everything below:
 *
 * - **Follow merges.** A lookup that lands on a row with `merged_into_id` set
 *   returns the row it points at. Binding to a merged-away row would silently
 *   undo the merge, one ingest at a time.
 * - **Never overwrite what is already known.** Canonical rows are shared across
 *   providers and outlive any of them, so an existing name, image or duration
 *   stands; ingest only fills blanks. Whatever the provider actually said
 *   survives verbatim in `track_sources.raw` either way.
 *
 * Deliberately not a service: it holds no policy beyond the resolution order,
 * and the request-path import will need exactly these primitives.
 */
@Injectable()
export class CatalogResolverRepository extends DataRepository {
    constructor(
        db: Kysely<DB>,
        private readonly logger: Logger,
    ) {
        super(db);
    }

    /**
     * The whole ingest for one provider item, as a single transaction.
     *
     * Atomic because the halves are worthless apart: a canonical track with no
     * binding is invisible to playout and would be re-created as a duplicate on
     * the next run, and a binding pointing at a track that was rolled back
     * violates its foreign key. One short transaction per item — rather than one
     * long one per run — is what lets the caller be a long, network-bound walk.
     *
     * Because it opens that transaction itself, this is for callers that have
     * none: a background job, not a request, which is already inside the one
     * `auditContextMiddleware` opened. A caller in a transaction composes
     * {@link resolveArtist}, {@link resolveAlbum}, {@link resolveTrack} and
     * {@link upsertTrackSource} directly instead — they are public for exactly
     * that, and they inherit whatever transaction the scope's `Kysely` is bound
     * to.
     *
     * @param pluginId - Manifest id of the providing plugin.
     * @param track - The item as the provider described it.
     * @returns The canonical track id, or why the item could not become one.
     */
    async ingestTrack(pluginId: string, track: ProviderTrack): Promise<IngestResult> {
        const artistName = track.artists[0];
        if (!artistName || normalizeKey(artistName).length === 0) {
            return { status: 'skipped', reason: 'no-artist' };
        }
        if (normalizeKey(track.title).length === 0 && normalizeKey(artistName).length === 0) {
            return { status: 'skipped', reason: 'unnamed' };
        }

        return this.db.transaction().execute(async trx => {
            const repo = this.withDb(trx);
            const artistId = await repo.resolveArtist(artistName);
            const albumId = track.album ? await repo.resolveAlbum(artistId, track.album, track.artworkUrl) : undefined;
            const resolved = await repo.resolveTrack(artistId, albumId, track);
            await repo.upsertTrackSource(resolved.id, pluginId, track);
            return { status: 'ingested', trackId: resolved.id, created: resolved.created };
        });
    }

    /**
     * The canonical artist for a name, created if this is the first sighting.
     *
     * The name is written once and never rewritten: providers disagree about
     * capitalization and accents ("BEYONCE", "Beyoncé"), and letting each sync
     * restate its own spelling would make the display name flip with whichever
     * provider ran last.
     */
    async resolveArtist(name: string): Promise<string> {
        const artistKey = normalizeKey(name);

        const existing = await this.db
            .selectFrom('deadair.artists')
            .select(['id', 'mergedIntoId'])
            .where('artistKey', '=', artistKey)
            .executeTakeFirst();
        if (existing) return this.followMerge('deadair.artists', existing);

        const inserted = await this.db
            .insertInto('deadair.artists')
            .values({ artistKey, name })
            .onConflict(oc => oc.column('artistKey').doNothing())
            .returning('id')
            .executeTakeFirst();
        if (inserted) return inserted.id;

        // `doNothing` returned nothing, so a concurrent ingest inserted the same
        // key between the select and here. Its row is the winner.
        const raced = await this.db
            .selectFrom('deadair.artists')
            .select(['id', 'mergedIntoId'])
            .where('artistKey', '=', artistKey)
            .executeTakeFirstOrThrow();
        return this.followMerge('deadair.artists', raced);
    }

    /**
     * The canonical album for a name under one artist. `imageUrl` is recorded
     * only when the album has none: a later enrichment pass should be able to
     * replace provider art without a sync overwriting it on the next run.
     */
    async resolveAlbum(artistId: string, name: string, imageUrl?: string): Promise<string> {
        const nameKey = normalizeKey(name);

        const existing = await this.db
            .selectFrom('deadair.albums')
            .select(['id', 'mergedIntoId'])
            .where('artistId', '=', artistId)
            .where('nameKey', '=', nameKey)
            .executeTakeFirst();

        const albumId = existing ? await this.followMerge('deadair.albums', existing) : await this.insertAlbum(artistId, name, nameKey, imageUrl);

        if (existing && imageUrl) await this.fillAlbumImage(albumId, imageUrl);
        return albumId;
    }

    /**
     * The canonical track for a provider item: isrc first, then the fuzzy keys,
     * then a new row.
     *
     * `album_id` and the nominal `duration_ms` / `year` are filled on an
     * existing row only when blank. The canonical duration is the recording's,
     * not this copy's — that one lives on the binding, where two rips of the
     * same track can honestly disagree.
     */
    async resolveTrack(artistId: string, albumId: string | undefined, track: TrackIdentity): Promise<{ id: string; created: boolean }> {
        const byIsrc = track.isrc ? await this.findByIsrc(track.isrc) : undefined;
        const existingId = byIsrc ?? (await this.findByKeys(artistId, track));

        if (existingId) {
            await this.fillTrackBlanks(existingId, albumId, track.durationMs);
            return { id: existingId, created: false };
        }

        const inserted = await this.db
            .insertInto('deadair.tracks')
            .values({
                artistId,
                albumId: albumId ?? null,
                artists: track.artists.join(', '),
                title: track.title,
                titleKey: normalizeKey(track.title),
                durationMs: track.durationMs ?? null,
            })
            .returning('id')
            .executeTakeFirstOrThrow();
        return { id: inserted.id, created: true };
    }

    /**
     * The binding for one provider's copy of a track.
     *
     * `last_seen_at` is stamped and `missing_at` cleared on both the insert and
     * the update paths, so a copy that comes back after a sweep marked it
     * missing un-marks itself without anyone having to notice it returned.
     *
     * `playable` is left alone on update: nothing sets it false yet, and when
     * something does (a regional restriction, a tombstoned file) that decision
     * should not be quietly reverted by the next sync.
     */
    async upsertTrackSource(trackId: string, pluginId: string, track: ProviderTrack): Promise<void> {
        const seen = {
            durationMs: track.durationMs ?? null,
            isrc: track.isrc ?? null,
            raw: this.toJsonb(track),
            lastSeenAt: sql<never>`now()`,
            missingAt: null,
        };

        await this.db
            .insertInto('deadair.trackSources')
            .values({ trackId, pluginId, externalId: track.id, ...seen })
            .onConflict(oc => oc.columns(['pluginId', 'externalId']).doUpdateSet({ trackId, ...seen }))
            .execute();
    }

    /** The track a provider's id is already bound to, if this is not the first sighting. */
    async findTrackSource(pluginId: string, externalId: string): Promise<string | undefined> {
        const row = await this.db
            .selectFrom('deadair.trackSources')
            .innerJoin('deadair.tracks', 'deadair.tracks.id', 'deadair.trackSources.trackId')
            .select(['deadair.tracks.id', 'deadair.tracks.mergedIntoId'])
            .where('deadair.trackSources.pluginId', '=', pluginId)
            .where('deadair.trackSources.externalId', '=', externalId)
            .executeTakeFirst();
        return row ? this.followMerge('deadair.tracks', row) : undefined;
    }

    /**
     * Marks every one of this plugin's bindings that the caller did not just
     * see. Canonical rows are never touched: the work still exists, this
     * provider simply stopped offering it.
     *
     * An empty `seenExternalIds` is refused rather than obeyed. `<> all('{}')`
     * is true of every row, so the honest reading of "I saw nothing" and the
     * catastrophic one ("mark this plugin's entire catalog missing") are the
     * same statement. A caller that genuinely wants that has to say so a
     * different way.
     *
     * @returns How many bindings were newly marked missing.
     */
    async markMissingTrackSources(pluginId: string, seenExternalIds: readonly string[]): Promise<number> {
        if (seenExternalIds.length === 0) {
            this.logger.warn('refusing to sweep a plugin that reported no tracks', { plugin: pluginId });
            return 0;
        }

        const result = await this.db
            .updateTable('deadair.trackSources')
            .set({ missingAt: sql<never>`now()` })
            .where('pluginId', '=', pluginId)
            .where('missingAt', 'is', null)
            .where(sql<boolean>`external_id <> all(${[...seenExternalIds]}::text[])`)
            .executeTakeFirst();
        return Number(result.numUpdatedRows ?? 0);
    }

    private async insertAlbum(artistId: string, name: string, nameKey: string, imageUrl?: string): Promise<string> {
        const inserted = await this.db
            .insertInto('deadair.albums')
            .values({ artistId, name, nameKey, imageUrl: imageUrl ?? null })
            .onConflict(oc => oc.columns(['artistId', 'nameKey']).doNothing())
            .returning('id')
            .executeTakeFirst();
        if (inserted) return inserted.id;

        const raced = await this.db
            .selectFrom('deadair.albums')
            .select(['id', 'mergedIntoId'])
            .where('artistId', '=', artistId)
            .where('nameKey', '=', nameKey)
            .executeTakeFirstOrThrow();
        return this.followMerge('deadair.albums', raced);
    }

    private async fillAlbumImage(albumId: string, imageUrl: string): Promise<void> {
        await this.db.updateTable('deadair.albums').set({ imageUrl }).where('id', '=', albumId).where('imageUrl', 'is', null).execute();
    }

    /**
     * The track whose binding already claims this isrc. Bindings are asked
     * rather than `tracks.isrc`, because there is no such column by design: a
     * reissue carries a fresh isrc for the same recording and providers
     * disagree, so the claim belongs per copy.
     */
    private async findByIsrc(isrc: string): Promise<string | undefined> {
        const row = await this.db
            .selectFrom('deadair.trackSources')
            .innerJoin('deadair.tracks', 'deadair.tracks.id', 'deadair.trackSources.trackId')
            .select(['deadair.tracks.id', 'deadair.tracks.mergedIntoId'])
            .where('deadair.trackSources.isrc', '=', isrc)
            .orderBy('deadair.tracks.createdAt', 'asc')
            .executeTakeFirst();
        return row ? this.followMerge('deadair.tracks', row) : undefined;
    }

    /**
     * The fuzzy rung: same artist, same normalized title.
     *
     * Skipped entirely for a title that normalizes to nothing, since that key
     * would match every other untitled track by the artist and quietly merge
     * them.
     *
     * Several matches is the interesting case — an album version and a single
     * edit are two legitimate rows sharing a title. Duration is the only
     * evidence available here, so the closest within tolerance wins and
     * otherwise the oldest does, which at least keeps the choice stable across
     * runs. It is logged because a wrong answer here is exactly how one track's
     * bindings end up on another.
     */
    private async findByKeys(artistId: string, track: TrackIdentity): Promise<string | undefined> {
        const titleKey = normalizeKey(track.title);
        if (titleKey.length === 0) return undefined;

        const candidates = await this.db
            .selectFrom('deadair.tracks')
            .select(['id', 'durationMs'])
            .where('artistId', '=', artistId)
            .where('titleKey', '=', titleKey)
            .where('mergedIntoId', 'is', null)
            .orderBy('createdAt', 'asc')
            .execute();

        const chosen = chooseTrackCandidate(candidates, track.durationMs);
        if (chosen && chosen.by !== 'only') {
            this.logger.debug('resolved an ambiguous title', { title: track.title, candidates: candidates.length, chosen: chosen.id, by: chosen.by });
        }
        return chosen?.id;
    }

    /** Fills the canonical columns ingest may learn but must not restate. */
    private async fillTrackBlanks(trackId: string, albumId: string | undefined, durationMs: number | undefined): Promise<void> {
        if (albumId !== undefined) {
            await this.db.updateTable('deadair.tracks').set({ albumId }).where('id', '=', trackId).where('albumId', 'is', null).execute();
        }
        if (durationMs !== undefined) {
            await this.db.updateTable('deadair.tracks').set({ durationMs }).where('id', '=', trackId).where('durationMs', 'is', null).execute();
        }
    }

    /**
     * The surviving row a lookup hit points at.
     *
     * Bounded rather than recursive-until-null: a merge cycle is a bug in
     * whatever wrote it, and a background walk is the worst place to discover it
     * as a hang. Giving up returns the last id reached, which is a stale answer
     * but a terminating one, and says so loudly.
     *
     * A pointer at a row that no longer exists yields the last id that did,
     * never the dangling pointer itself: handing that back would look like a
     * valid id right up until a foreign key rejected it.
     */
    private async followMerge(table: MergeableTable, row: { id: string; mergedIntoId: Nullable<string> }): Promise<string> {
        let current = row;
        for (let hop = 0; hop < MAX_MERGE_HOPS; hop++) {
            if (current.mergedIntoId == null) return current.id;
            const next = await this.db.selectFrom(table).select(['id', 'mergedIntoId']).where('id', '=', current.mergedIntoId).executeTakeFirst();
            if (!next) {
                this.logger.warn('merge pointer refers to a row that is gone', { table, from: current.id, to: current.mergedIntoId });
                return current.id;
            }
            current = next;
        }

        this.logger.error('merge chain did not terminate', { table, from: row.id, stoppedAt: current.id, hops: MAX_MERGE_HOPS });
        return current.id;
    }

    /** A copy of this repository bound to an open transaction. */
    private withDb(db: Kysely<DB>): CatalogResolverRepository {
        return new CatalogResolverRepository(db, this.logger);
    }

    /** jsonb columns are typed as `Json` by kysely-codegen; pg wants the serialized form. */
    private toJsonb(value: unknown): null {
        return JSON.stringify(value) as unknown as null;
    }
}
