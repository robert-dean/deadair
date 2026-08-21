import { Injectable } from 'injectkit';
import { Kysely, sql } from 'kysely';
import { Logger } from '@maroonedsoftware/logger';
import type { ProviderTrack } from '@deadair/plugin-sdk';
import { DataRepository } from '../../data/data.repository.js';
import { DB } from '../../data/db.js';
import { toJsonb } from '../../data/jsonb.js';
import { normalizeKey } from '../catalog.keys.js';

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
 * How a copy came to be in the catalog, which is the only thing that decides whether the sync's
 * missing sweep may judge it.
 *
 * `sync` is a copy a playlist walk saw and `discovered` is one looked up by name because something
 * chose the record. The distinction exists because the sweep marks whatever a clean walk did not
 * see, and a discovered copy is in no playlist — so without it the first sync after a discovery
 * benches the record. See `markMissingTrackSources` and the column comment in `0005_music.sql`.
 */
export type TrackSourceOrigin = 'sync' | 'discovered';

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

/** What a resolved track needs, independent of which provider described it. */
export interface TrackIdentity {
    title: string;
    /** Ordered, primary artist first. */
    artists: string[];
    album?: string;
    durationMs?: number;
    isrc?: string;
    artworkUrl?: string;
    /**
     * First release year, when the provider reports one. Four digits; see
     * `ProviderTrack.year` for why it is not a date.
     */
    year?: number;
}

/** A canonical track competing to be the match for an incoming item. */
export interface TrackCandidate {
    id: string;
    durationMs: Nullable<number>;
}

/**
 * The bounds a release year has to fall inside to be believed.
 *
 * Wide on purpose: this is a sanity check on a number a plugin handed over, not
 * an opinion about what a station may hold. Recorded music starts well inside
 * the lower bound, and the upper one is where a year stops being a year and
 * starts being a parse that went wrong — the same pair `spotify.mapping.ts`
 * closes an open-ended search range against.
 */
const YEAR_MIN = 1900;
const YEAR_MAX = 2100;

/**
 * A release year worth storing, or nothing.
 *
 * Guarded rather than trusted because the values arrive from plugin code and
 * three of the ways they go wrong are silent: Subsonic sends `0` for an
 * untagged file, a date parsed with the wrong slice gives a two-digit number,
 * and a `NaN` from a failed `Number()` writes as null in some drivers and
 * throws in others. A year nobody can believe is worse than no year, because a
 * period filter reads the absent one as eligible and the wrong one as proof.
 */
const usableYear = (value: number | undefined): number | undefined => {
    if (value === undefined || !Number.isFinite(value)) return undefined;
    const year = Math.trunc(value);
    return year >= YEAR_MIN && year <= YEAR_MAX ? year : undefined;
};

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
 * Row-level throughout: each method finds or writes one thing. Sequencing them
 * into a complete ingest, and deciding what that sequence commits as, is
 * {@link CatalogResolverService}'s job — which is also why nothing here opens a
 * transaction. A caller already inside one (a request, via
 * `auditContextMiddleware`) composes these directly and inherits it.
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
     * This repository bound to an open transaction, for a caller that opened one
     * and needs these methods to run inside it.
     *
     * Necessary because the injected `Kysely` is fixed at construction: a job's
     * scope has no ambient transaction to inherit (unlike a request's, which
     * `auditContextMiddleware` overrides), so the only way in is to hand the
     * transaction over explicitly.
     */
    withTransaction(trx: Kysely<DB>): CatalogResolverRepository {
        return new CatalogResolverRepository(trx, this.logger);
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
     * The canonical artist for a name, or nothing. Never creates.
     *
     * The lookup-only counterpart to {@link resolveArtist}, for callers asking
     * "is this already in the library?" rather than "put this in the library".
     */
    async findArtist(name: string): Promise<string | undefined> {
        const row = await this.db
            .selectFrom('deadair.artists')
            .select(['id', 'mergedIntoId'])
            .where('artistKey', '=', normalizeKey(name))
            .executeTakeFirst();
        return row ? this.followMerge('deadair.artists', row) : undefined;
    }

    /**
     * The canonical track an item refers to, if the library already has it.
     *
     * The same isrc-then-fuzzy ladder {@link resolveTrack} walks, stopping short
     * of the insert. Separate from it rather than a flag on it, because the
     * distinction is the point: a caller re-checking an item nobody has (an
     * unresolved playlist placeholder) must not conjure a canonical track for
     * music the station cannot play. That would make the row look resolved, and
     * quietly grow a library of phantoms.
     */
    async findTrack(identity: TrackIdentity): Promise<string | undefined> {
        if (identity.isrc) {
            const byIsrc = await this.findByIsrc(identity.isrc);
            if (byIsrc) return byIsrc;
        }

        const artistName = identity.artists[0];
        if (!artistName) return undefined;
        const artistId = await this.findArtist(artistName);
        if (!artistId) return undefined;

        return this.findByKeys(artistId, identity);
    }

    /**
     * The canonical album for a name under one artist. `imageUrl` and `year` are
     * recorded only when the album has none: a later enrichment pass should be
     * able to replace provider art or a provider's release year without a sync
     * overwriting it on the next run.
     */
    async resolveAlbum(artistId: string, name: string, imageUrl?: string, year?: number): Promise<string> {
        const nameKey = normalizeKey(name);
        const released = usableYear(year);

        const existing = await this.db
            .selectFrom('deadair.albums')
            .select(['id', 'mergedIntoId'])
            .where('artistId', '=', artistId)
            .where('nameKey', '=', nameKey)
            .executeTakeFirst();

        const albumId = existing
            ? await this.followMerge('deadair.albums', existing)
            : await this.insertAlbum(artistId, name, nameKey, imageUrl, released);

        if (existing) await this.fillAlbumBlanks(albumId, imageUrl, released);
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
            await this.fillTrackBlanks(existingId, albumId, track.durationMs, usableYear(track.year));
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
                year: usableYear(track.year) ?? null,
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
     *
     * `origin` is written on BOTH paths, which is what keeps the sweep honest in
     * the direction that matters. A copy first found by a lookup and later seen
     * in a playlist becomes `sync` and rejoins the sweep, because from then on a
     * walk that does not see it is saying something real about it. The reverse
     * does not happen: a lookup passes `discovered`, so re-finding a synced copy
     * by name would take it OUT of the sweep, which is why the update writes
     * `least`-style rather than blindly — see the coalesce below.
     *
     * @param origin - How this sighting was made. Defaults to the walk, which is
     *   the only caller that enumerates anything.
     */
    async upsertTrackSource(trackId: string, pluginId: string, track: ProviderTrack, origin: TrackSourceOrigin = 'sync'): Promise<void> {
        const seen = {
            durationMs: track.durationMs ?? null,
            isrc: track.isrc ?? null,
            // Per binding for the same reason `isrc` is: a clean edit and the explicit original
            // collapse to one canonical track and stay two copies, so the marking belongs to the
            // copy. Absent becomes null rather than 'clean' — the SDK is explicit that a silent
            // provider has said nothing, and a clean-only station demands a positive answer.
            //
            // `?? null` rather than letting `undefined` through, which is the plugin-side spelling
            // of the same absence. This object is spread into the UPDATE arm as well, and Kysely
            // drops an `undefined` from a `set` rather than writing it, so a provider that stopped
            // reporting would leave a stale mark standing instead of clearing it. Null here is
            // "clear the column", which is the one thing null is for.
            advisory: track.advisory ?? null,
            raw: toJsonb(track),
            lastSeenAt: sql<never>`now()`,
            missingAt: null,
        };

        await this.db
            .insertInto('deadair.trackSources')
            .values({ trackId, pluginId, externalId: track.id, origin, ...seen })
            .onConflict(oc =>
                oc.columns(['pluginId', 'externalId']).doUpdateSet({
                    trackId,
                    ...seen,
                    // A sighting can only ever move a copy INTO the sweep, never out of it. A walk
                    // seeing a discovered copy is new information — a playlist advertises it now,
                    // so a later walk that does not is worth acting on. A lookup finding a synced
                    // copy is not: it says nothing about the playlists, and taking the row out of
                    // the sweep would exempt a normal binding for good the first time a model
                    // happened to name it.
                    ...(origin === 'sync' ? { origin } : {}),
                }),
            )
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
     * **Only `origin = 'sync'` bindings are judged.** The caller has just walked
     * this provider's PLAYLISTS, which is the only enumeration a provider
     * offers, so "I did not see it" is evidence about a copy a playlist once
     * advertised and no evidence at all about one that was looked up by name.
     * Without this the first sync after a discovery would bench every record the
     * station found for itself, an hour after finding it.
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
            .where('origin', '=', 'sync')
            .where(sql<boolean>`external_id <> all(${[...seenExternalIds]}::text[])`)
            .executeTakeFirst();
        return Number(result.numUpdatedRows ?? 0);
    }

    private async insertAlbum(artistId: string, name: string, nameKey: string, imageUrl?: string, year?: number): Promise<string> {
        const inserted = await this.db
            .insertInto('deadair.albums')
            .values({ artistId, name, nameKey, imageUrl: imageUrl ?? null, year: year ?? null })
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

    /** {@link fillTrackBlanks} for an album: the same fill-when-blank rule, for the same reason. */
    private async fillAlbumBlanks(albumId: string, imageUrl: string | undefined, year: number | undefined): Promise<void> {
        if (imageUrl !== undefined) {
            await this.db.updateTable('deadair.albums').set({ imageUrl }).where('id', '=', albumId).where('imageUrl', 'is', null).execute();
        }
        if (year !== undefined) {
            await this.db.updateTable('deadair.albums').set({ year }).where('id', '=', albumId).where('year', 'is', null).execute();
        }
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

    /**
     * Fills the canonical columns ingest may learn but must not restate.
     *
     * `year` joins the two that were already here, and the fill-when-blank rule is
     * what keeps it from fighting enrichment: a provider dates the RELEASE it
     * carries, so a 2011 remaster of a 1973 record comes through as 2011, while
     * `enrichment.repository.ts` promotes the recording's own year from a source
     * that knows the difference. Whichever arrives first wins and neither
     * overwrites, which is the same bargain `album_id` and `duration_ms` already
     * make. Before this, nothing but enrichment ever wrote the column at all.
     */
    private async fillTrackBlanks(
        trackId: string,
        albumId: string | undefined,
        durationMs: number | undefined,
        year: number | undefined,
    ): Promise<void> {
        if (albumId !== undefined) {
            await this.db.updateTable('deadair.tracks').set({ albumId }).where('id', '=', trackId).where('albumId', 'is', null).execute();
        }
        if (durationMs !== undefined) {
            await this.db.updateTable('deadair.tracks').set({ durationMs }).where('id', '=', trackId).where('durationMs', 'is', null).execute();
        }
        if (year !== undefined) {
            await this.db.updateTable('deadair.tracks').set({ year }).where('id', '=', trackId).where('year', 'is', null).execute();
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
}
