import { Injectable } from 'injectkit';
import { sql, type ExpressionBuilder } from 'kysely';
import { DataRepository } from '../data/data.repository.js';
import type { DB } from '../data/db.js';
import { CatalogListQuery, likeContains } from './catalog.query.js';
import { artUrl } from './catalog.art.js';
import { ratingFromColumn } from './rating.js';
import type { Rating, TrackState } from './types/catalog.types.js';

/** Database spelling, because {@link artUrl} is raw SQL and reads the column twice. */
const ALBUM_IMAGE_COLUMN = 'deadair.albums.image_url';

/**
 * What a track list can be narrowed by, on top of the shared page and search.
 *
 * `schemaVersion` rides along rather than being read here because "measured" means measured at a
 * version the station still trusts, and that constant belongs to the analysis module — a catalog
 * repository importing it would be the catalog deciding what a good measurement is.
 */
export type TrackListQuery = CatalogListQuery & {
    state?: TrackState;
    schemaVersion: number;
};

/** The tables a track list has in scope, for the predicates below. */
type TrackScope = ExpressionBuilder<DB, 'deadair.tracks' | 'deadair.artists' | 'deadair.albums'>;

/**
 * The bytes are on this machine.
 *
 * `exists` over the binding join rather than a join into the list, because a record with four copies
 * would otherwise come back four times the moment one of them had audio. The predicate is
 * `checksum is not null`, the same one every other reader of `track_audio` uses: a row with no
 * checksum is a remembered failure rather than a cache hit.
 */
const hasAudio = (eb: TrackScope) =>
    eb.exists(
        eb
            .selectFrom('deadair.trackSources as s')
            .innerJoin('deadair.trackAudio as a', 'a.sourceId', 's.id')
            .select('s.id')
            .whereRef('s.trackId', '=', 'deadair.tracks.id')
            .where('a.checksum', 'is not', null),
    );

/**
 * Measured, and trustworthy about it.
 *
 * Three conditions and all three are load-bearing: a row exists, its `complete` is true, and its
 * schema is one the station still reads. A measurement of a truncated download is confident and
 * wrong, which is why `complete` is separate from `analyzed_at` in the first place, and a row from
 * an older schema may hold fields that have since changed meaning.
 */
const isMeasured = (eb: TrackScope, schemaVersion: number) =>
    eb.exists(
        eb
            .selectFrom('deadair.trackAnalysis as an')
            .select('an.id')
            .whereRef('an.trackId', '=', 'deadair.tracks.id')
            .where('an.complete', '=', true)
            .where('an.schemaVersion', '>=', schemaVersion),
    );

/**
 * Some provider has answered about it.
 *
 * A row with an empty payload is a recorded MISS — the provider was asked and had nothing — so it
 * does not count as enriched, which is why this looks at the payload rather than at the row. The
 * same rule `EnrichmentReadService` applies when it decides `found`.
 */
const isEnriched = (eb: TrackScope) =>
    eb.exists(
        eb
            .selectFrom('deadair.trackEnrichment as e')
            .select('e.id')
            .whereRef('e.trackId', '=', 'deadair.tracks.id')
            .where(sql<boolean>`e.data <> '{}'::jsonb`),
    );

/**
 * Every copy written off, which is the one state that means the record CANNOT air.
 *
 * Two halves, and the first is what stops it swallowing a different fact: there has to BE a copy.
 * A record nobody has a copy of at all is an import whose lookup never resolved, which is its own
 * problem and reads as `uncached` rather than as benched.
 */
const isBenched = (eb: TrackScope) =>
    eb.and([
        eb.exists(eb.selectFrom('deadair.trackSources as s').select('s.id').whereRef('s.trackId', '=', 'deadair.tracks.id')),
        eb.not(
            eb.exists(
                eb
                    .selectFrom('deadair.trackSources as s')
                    .select('s.id')
                    .whereRef('s.trackId', '=', 'deadair.tracks.id')
                    .where('s.playable', '=', true)
                    .where('s.missingAt', 'is', null),
            ),
        ),
    ]);

/**
 * A fetch has failed on a copy the station is STILL OFFERING, and is backing off.
 *
 * Not the same as benched and usually the state before it: four consecutive failures is what writes
 * a copy off, so this is the window in which an operator can still do something about the upstream.
 *
 * The `playable` and `missing_at` conditions are what keep the two apart once a copy has been given
 * up on. Without them a written-off copy reads as failing forever — its attempts and its missing
 * checksum are still on the row, and both are true statements about the past — which would leave the
 * one actionable filter permanently full of records nothing is trying any more.
 */
const isFailing = (eb: TrackScope) =>
    eb.exists(
        eb
            .selectFrom('deadair.trackSources as s')
            .innerJoin('deadair.trackAudio as a', 'a.sourceId', 's.id')
            .select('s.id')
            .whereRef('s.trackId', '=', 'deadair.tracks.id')
            .where('s.playable', '=', true)
            .where('s.missingAt', 'is', null)
            .where('a.checksum', 'is', null)
            .where('a.attempts', '>', 0),
    );

/** One state, as a predicate over the list query. */
function stateFilter(eb: TrackScope, state: TrackState, schemaVersion: number) {
    switch (state) {
        case 'cached':
            return hasAudio(eb);
        case 'uncached':
            return eb.not(hasAudio(eb));
        case 'unmeasured':
            return eb.not(isMeasured(eb, schemaVersion));
        case 'benched':
            return isBenched(eb);
        case 'failing':
            return isFailing(eb);
    }
}

/** `titleKey` is a match key for ingest and never read out; the two names are joined in below. */
const TRACK_COLUMNS = [
    'deadair.tracks.id',
    'deadair.tracks.title',
    'deadair.tracks.artistId',
    'deadair.tracks.albumId',
    'deadair.tracks.artists',
    'deadair.tracks.genre',
    'deadair.tracks.year',
    'deadair.tracks.durationMs',
    'deadair.tracks.rating',
    'deadair.artists.name as artistName',
    'deadair.albums.name as albumName',
] as const;

@Injectable()
export class TracksRepository extends DataRepository {
    /**
     * Every track the catalog will show, joined to the two rows a `Track` is drawn from.
     *
     * The album join is left, not inner: `tracks.album_id` is nullable, and a single ingested
     * outside any release is a track the catalog holds rather than a row to drop. Merged rows are
     * excluded here rather than at each call site, because a read never returns one.
     */
    private readable() {
        return this.db
            .selectFrom('deadair.tracks')
            .innerJoin('deadair.artists', 'deadair.artists.id', 'deadair.tracks.artistId')
            .leftJoin('deadair.albums', 'deadair.albums.id', 'deadair.tracks.albumId')
            .where('deadair.tracks.mergedIntoId', 'is', null);
    }

    /**
     * @param albumId - Narrows to one album's tracks. Absent lists the whole catalog.
     */
    async listTracks(query: TrackListQuery, albumId?: string) {
        const { limit, offset, sort, search, state, schemaVersion } = query;

        let scoped = this.readable();
        if (albumId !== undefined) {
            scoped = scoped.where('deadair.tracks.albumId', '=', albumId);
        }
        if (search !== undefined) {
            scoped = scoped.where('deadair.tracks.title', 'ilike', likeContains(search));
        }
        if (state !== undefined) {
            scoped = scoped.where(eb => stateFilter(eb, state, schemaVersion));
        }

        const { total } = await scoped.select(eb => eb.fn.countAll<number>().as('total')).executeTakeFirstOrThrow();
        const data = await scoped
            .select(TRACK_COLUMNS)
            // A track's art is its record's: nothing hangs a cover off a recording. Off the join
            // that is already there, so a list of fifty rows still costs one query.
            .select(artUrl(ALBUM_IMAGE_COLUMN, 'albumImageUrl'))
            // Three `exists` rather than three joins, which is what keeps a page of fifty at one
            // query and no row multiplication: a record with four copies must not come back four
            // times because one of them has bytes.
            .select(eb => [
                hasAudio(eb).as('hasAudio'),
                isMeasured(eb, schemaVersion).as('measured'),
                isEnriched(eb).as('enriched'),
            ])
            .orderBy('deadair.tracks.title', sort)
            .orderBy('deadair.tracks.id', 'asc')
            .limit(limit)
            .offset(offset)
            .execute();

        return { total: Number(total), data };
    }

    /**
     * How much of the library is in each state, over the same set the page was drawn from.
     *
     * One query with five conditional counts rather than five queries, because they are all the same
     * scan: the aggregate an operator reads first is "N of M measured", and asking the database five
     * times for one sentence would be five sequential scans of the catalog per page view.
     *
     * It honours `search` and the album narrowing and deliberately IGNORES `state`: the counts are
     * what the filter is chosen FROM, so filtering them by the current choice would answer "of the
     * benched records, how many are benched".
     */
    async trackStateCounts(query: TrackListQuery, albumId?: string) {
        const { search, schemaVersion } = query;

        let scoped = this.readable();
        if (albumId !== undefined) scoped = scoped.where('deadair.tracks.albumId', '=', albumId);
        if (search !== undefined) scoped = scoped.where('deadair.tracks.title', 'ilike', likeContains(search));

        const counted = await scoped
            .select(eb => [
                eb.fn.countAll<number>().as('total'),
                eb.fn.count<number>(eb.case().when(hasAudio(eb)).then(1).end()).as('cached'),
                eb.fn.count<number>(eb.case().when(isMeasured(eb, schemaVersion)).then(1).end()).as('measured'),
                eb.fn.count<number>(eb.case().when(isEnriched(eb)).then(1).end()).as('enriched'),
                eb.fn.count<number>(eb.case().when(isBenched(eb)).then(1).end()).as('benched'),
                eb.fn.count<number>(eb.case().when(isFailing(eb)).then(1).end()).as('failing'),
            ])
            .executeTakeFirstOrThrow();

        return {
            total: Number(counted.total),
            cached: Number(counted.cached),
            measured: Number(counted.measured),
            enriched: Number(counted.enriched),
            benched: Number(counted.benched),
            failing: Number(counted.failing),
        };
    }

    /**
     * Records the station could actually put on air, matching a title or an artist.
     *
     * Written for the model's discovery tool rather than for the console, which is why it is not
     * {@link listTracks} with another flag: that one browses a library, counts it and pages through
     * it, and this one answers "what could you play me" in one shot.
     *
     * **Bans narrow it; rotation rules do not**, and the line between them is the whole design.
     * Anything with no live binding, anything merged away and anything DISLIKED is excluded, because
     * offering those is offering a record that cannot air or that the operator forbade outright. A
     * record inside the repeat window or an artist inside the cooldown is deliberately still
     * offered: those are enforced at the point of choice, and pre-filtering them returns a worse
     * pool on a small library while making the model's own variety logic invisible. See
     * `LibrarySearchTool`.
     *
     * The three exclusions are the same ones `CandidatesRepository.sample` applies, for the same
     * reasons, and they are stated in both places rather than shared: a sample and a search are
     * different questions, and a helper spanning them would have to grow a flag per caller.
     *
     * `cleanOnly` joins the bans rather than the rotation rules, on the same split. A station that
     * may only play positively-clean copies must not be OFFERED anything else, because a record it
     * cannot air is a record the model will name and lose. The two `prefer-` states deliberately do
     * not narrow this at all: they are a preference between two copies of one work, and the work is
     * playable either way.
     *
     * @param cleanOnly - Whether the station demands a positively `clean` copy. Null means the
     *   provider did not say and is excluded here too; see `advisory.policy.ts`.
     */
    async searchPlayable(search: string, limit: number, cleanOnly = false) {
        const pattern = likeContains(search);

        return await this.db
            .selectFrom('deadair.tracks')
            .innerJoin('deadair.artists', 'deadair.artists.id', 'deadair.tracks.artistId')
            .leftJoin('deadair.albums', 'deadair.albums.id', 'deadair.tracks.albumId')
            .select([
                'deadair.tracks.title',
                'deadair.tracks.year',
                'deadair.tracks.genre',
                'deadair.artists.name as artistName',
                'deadair.albums.name as albumName',
            ])
            .where('deadair.tracks.mergedIntoId', 'is', null)
            // Title, artist OR genre.
            //
            // The first two are obvious: a DJ looking for a record knows one or the other, and
            // matching titles alone answers nothing for "play me some Aphex Twin".
            //
            // Genre was NOT obvious and was added after watching a model use this. Asked to
            // programme an hour it searched `hard rock`, `metal band 80s` and `rock classic` — all
            // three found nothing, and it apologised that the library was empty when the library
            // was full. It reaches for a style because that is how anyone thinks about programming
            // radio, and because this very method RETURNS a genre on every row, which reads as an
            // invitation to search one. Answering nothing to the field you just handed back is the
            // kind of gap that looks like a thin catalogue from the outside.
            .where(eb =>
                eb.or([
                    eb('deadair.tracks.title', 'ilike', pattern),
                    eb('deadair.artists.name', 'ilike', pattern),
                    eb('deadair.tracks.genre', 'ilike', pattern),
                ]),
            )
            .where(eb =>
                eb.exists(
                    eb
                        .selectFrom('deadair.trackSources')
                        .select('deadair.trackSources.id')
                        .whereRef('deadair.trackSources.trackId', '=', 'deadair.tracks.id')
                        .where('deadair.trackSources.missingAt', 'is', null)
                        // A POSITIVE 'clean'; null is "the provider did not say", never consent.
                        .$if(cleanOnly, qb => qb.where('deadair.trackSources.advisory', '=', 'clean')),
                ),
            )
            .where('deadair.tracks.rating', '<>', -1)
            .where('deadair.artists.rating', '<>', -1)
            .where(eb => eb.or([eb('deadair.albums.rating', 'is', null), eb('deadair.albums.rating', '<>', -1)]))
            // Stable, so asking twice in one conversation does not shuffle the answer under the
            // model and make it think the library changed.
            .orderBy('deadair.tracks.title', 'asc')
            .orderBy('deadair.tracks.id', 'asc')
            .limit(limit)
            .execute();
    }

    /**
     * What the catalog can say about a batch of canonical tracks, for display.
     *
     * The other direction from {@link findByBindings}: that one starts from a
     * provider's id, this one from the work itself. What both exist for is the
     * same — anything holding a track has to be able to name its record, its year
     * and its cover without three more queries.
     *
     * Ids the catalog does not hold are simply absent from the result.
     */
    async findByIds(trackIds: readonly string[]) {
        if (trackIds.length === 0) return new Map<string, { title: string; credit: string; album?: string; year?: number; artworkUrl?: string }>();

        const rows = await this.db
            .selectFrom('deadair.tracks')
            .leftJoin('deadair.albums', 'deadair.albums.id', 'deadair.tracks.albumId')
            .select([
                'deadair.tracks.id',
                'deadair.tracks.title',
                'deadair.tracks.artists',
                'deadair.tracks.year',
                'deadair.albums.name as albumName',
            ])
            .select(artUrl(ALBUM_IMAGE_COLUMN, 'albumImageUrl'))
            .where('deadair.tracks.id', 'in', [...trackIds])
            .where('deadair.tracks.mergedIntoId', 'is', null)
            .execute();

        return new Map(
            rows.map(row => [
                row.id,
                {
                    title: row.title,
                    credit: row.artists,
                    ...(row.albumName == null ? {} : { album: row.albumName }),
                    ...(row.year == null ? {} : { year: row.year }),
                    ...(row.albumImageUrl == null ? {} : { artworkUrl: row.albumImageUrl }),
                },
            ]),
        );
    }

    /**
     * The canonical rows behind a batch of one provider's ids: what the catalog
     * knows about tracks a caller is holding by binding alone.
     *
     * The direction ingest does not go. It resolves a provider item TO a canonical
     * row; this asks the same question of rows that already exist, which is what
     * anything holding a `(plugin_id, external_id)` pair — the running order, the
     * station playlist — needs to say more about a track than the provider bothered
     * to tell it.
     *
     * Batched because the caller has a whole playlist: one query for a hundred
     * tracks rather than a hundred round trips behind a request an operator is
     * waiting on. Ids the catalog has never seen are simply absent from the result,
     * so a caller learns nothing rather than being handed an empty row to
     * misinterpret.
     *
     * A binding marked `missing_at` still answers. It means this provider stopped
     * offering the track, which says nothing about what the work IS, and the
     * metadata is the whole question here.
     */
    async findByBindings(pluginId: string, externalIds: readonly string[]) {
        if (externalIds.length === 0) return [];

        return (
            this.db
                .selectFrom('deadair.trackSources')
                .innerJoin('deadair.tracks', 'deadair.tracks.id', 'deadair.trackSources.trackId')
                // Left, like the list above: a single ingested outside any release is still a track.
                .leftJoin('deadair.albums', 'deadair.albums.id', 'deadair.tracks.albumId')
                .select([
                    'deadair.trackSources.externalId',
                    'deadair.tracks.id as trackId',
                    'deadair.tracks.year',
                    'deadair.albums.name as albumName',
                ])
                .select(artUrl(ALBUM_IMAGE_COLUMN, 'albumImageUrl'))
                .where('deadair.trackSources.pluginId', '=', pluginId)
                .where('deadair.trackSources.externalId', 'in', [...externalIds])
                // A merged row is a duplicate the catalog has already disowned; its metadata
                // is the same work described twice, and reading it would report the loser.
                .where('deadair.tracks.mergedIntoId', 'is', null)
                .execute()
        );
    }

    /**
     * Write off one provider's copy of a track, because its audio never arrives.
     *
     * The one WRITE in this file, and it is here rather than in the playout module because the catalog
     * owns `track_sources`. What it means is what `missing_at` has always meant — this provider will not
     * give us this track — arrived at from the other direction: ingest stops seeing it in a listing,
     * this notices the audio refusing to be fetched. Both are the same fact about the same binding, and
     * every reader already excludes on it (`CandidatesRepository.sample` and `bindingsFor`, the analysis
     * walk, and the transport's own resolver), so one statement takes the copy out of rotation, out of
     * binding selection, out of measurement and out of the running order.
     *
     * `where missing_at is null` makes it idempotent and stops a repeat pushing the timestamp forward:
     * the interesting fact is WHEN the station gave up, and a later attempt is not a fresh giving-up.
     *
     * **Not permanent, and that is the point of using this column.** `upsertTrackSource` clears
     * `missing_at` on every re-sighting, so the hourly `catalog.sync` un-benches a binding the provider
     * still lists — the copy gets one more attempt, cheaply, and is benched again if it still refuses.
     * A permanent mark would need `playable`, which nothing clears, and a transient outage would then
     * bench a record for good.
     */
    async markBindingMissing(pluginId: string, externalId: string): Promise<boolean> {
        const result = await this.db
            .updateTable('deadair.trackSources')
            .set({ missingAt: sql<never>`now()` })
            .where('pluginId', '=', pluginId)
            .where('externalId', '=', externalId)
            .where('missingAt', 'is', null)
            .executeTakeFirst();

        return (result.numUpdatedRows ?? 0n) > 0n;
    }

    /**
     * Stop offering a copy for good, because the provider says it has no audio for it.
     *
     * The permanent twin of {@link markBindingMissing}, and the difference is which column: this
     * writes `playable`, which **nothing clears** — not the hourly sync, not a re-sighting, not the
     * operator's retry, which is deliberate on all three counts. `missing_at` is the station's own
     * guess from repeated failures and has to be revisable; this is the provider answering, and a
     * mark that healed itself would put the record back in rotation to fail again next hour.
     *
     * `upsertTrackSource` leaves `playable` alone on update precisely so this survives, and has said
     * so since before anything wrote it.
     *
     * Idempotent, and answers whether it changed anything, so a caller can say something once rather
     * than on every later attempt that finds the copy already written off.
     */
    async markBindingUnplayable(pluginId: string, externalId: string): Promise<boolean> {
        const result = await this.db
            .updateTable('deadair.trackSources')
            .set({ playable: false })
            .where('pluginId', '=', pluginId)
            .where('externalId', '=', externalId)
            .where('playable', '=', true)
            .executeTakeFirst();

        return (result.numUpdatedRows ?? 0n) > 0n;
    }

    /**
     * What the station thinks of a batch of tracks, as the wire spells it.
     *
     * For the running order, which holds ids and needs each row's opinion to draw a control that is
     * not lying about what the operator already said. It is read as the order is DRAWN rather than
     * stored in the lineup document: the director owns that document, and a rating copied into it
     * would be a second answer going stale the moment the operator changed their mind.
     *
     * Deliberately each track's OWN rating rather than the effective one `CandidatesRepository`
     * resolves. That one answers "may this air", which is a `least()` over three rows; this one is
     * what a control has to show, and a track reading as disliked because of its artist would
     * change the wrong row when the operator clicked it.
     *
     * Ids the catalog has never seen are absent, which is an ordinary state: a station can air a
     * track it has not ingested.
     */
    async ratingsByTrackId(trackIds: readonly string[]): Promise<Map<string, Rating>> {
        if (trackIds.length === 0) return new Map();

        const rows = await this.db
            .selectFrom('deadair.tracks')
            .select(['deadair.tracks.id', 'deadair.tracks.rating'])
            .where('deadair.tracks.id', 'in', [...trackIds])
            .where('deadair.tracks.mergedIntoId', 'is', null)
            .execute();

        return new Map(rows.map(row => [row.id, ratingFromColumn(Number(row.rating))]));
    }

    /** One track, in the shape a list row has. Undefined when there is no such track, and equally when it was merged away. */
    async findTrack(id: string) {
        return await this.readable()
            .where('deadair.tracks.id', '=', id)
            .select(TRACK_COLUMNS)
            .select(artUrl(ALBUM_IMAGE_COLUMN, 'albumImageUrl'))
            .executeTakeFirst();
    }

    /** What the station thinks of this song, as the column spells it. Merged rows are not rated; see `ArtistsRepository.setRating`. */
    async setRating(id: string, rating: number): Promise<boolean> {
        const result = await this.db
            .updateTable('deadair.tracks')
            .set({ rating })
            .where('deadair.tracks.id', '=', id)
            .where('deadair.tracks.mergedIntoId', 'is', null)
            .executeTakeFirst();

        return (result.numUpdatedRows ?? 0n) > 0n;
    }
}
