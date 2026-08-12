import { Injectable } from 'injectkit';
import { sql } from 'kysely';
import { DataRepository } from '../data/data.repository.js';
import { CatalogListQuery, likeContains } from './catalog.query.js';
import { artUrl } from './catalog.art.js';
import { ratingFromColumn } from './rating.js';
import type { Rating } from './types/catalog.types.js';

/** Database spelling, because {@link artUrl} is raw SQL and reads the column twice. */
const ALBUM_IMAGE_COLUMN = 'deadair.albums.image_url';

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
    async listTracks(query: CatalogListQuery, albumId?: string) {
        const { limit, offset, sort, search } = query;

        let scoped = this.readable();
        if (albumId !== undefined) {
            scoped = scoped.where('deadair.tracks.albumId', '=', albumId);
        }
        if (search !== undefined) {
            scoped = scoped.where('deadair.tracks.title', 'ilike', likeContains(search));
        }

        const { total } = await scoped.select(eb => eb.fn.countAll<number>().as('total')).executeTakeFirstOrThrow();
        const data = await scoped
            .select(TRACK_COLUMNS)
            // A track's art is its record's: nothing hangs a cover off a recording. Off the join
            // that is already there, so a list of fifty rows still costs one query.
            .select(artUrl(ALBUM_IMAGE_COLUMN, 'albumImageUrl'))
            .orderBy('deadair.tracks.title', sort)
            .orderBy('deadair.tracks.id', 'asc')
            .limit(limit)
            .offset(offset)
            .execute();

        return { total: Number(total), data };
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
     */
    async searchPlayable(search: string, limit: number) {
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
                        .where('deadair.trackSources.missingAt', 'is', null),
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
