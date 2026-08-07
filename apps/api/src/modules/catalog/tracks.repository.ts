import { Injectable } from 'injectkit';
import { DataRepository } from '../data/data.repository.js';
import { CatalogListQuery, likeContains } from './catalog.query.js';
import { artUrl } from './catalog.art.js';

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
     * @param albumId - Narrows to one album's tracks. Absent lists the whole catalog.
     */
    async listTracks(query: CatalogListQuery, albumId?: string) {
        const { limit, offset, sort, search } = query;

        // The album join is left, not inner: `tracks.album_id` is nullable, and a single ingested
        // outside any release is a track the catalog holds rather than a row to drop.
        let scoped = this.db
            .selectFrom('deadair.tracks')
            .innerJoin('deadair.artists', 'deadair.artists.id', 'deadair.tracks.artistId')
            .leftJoin('deadair.albums', 'deadair.albums.id', 'deadair.tracks.albumId')
            .where('deadair.tracks.mergedIntoId', 'is', null);
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
            .select(['deadair.tracks.id', 'deadair.tracks.title', 'deadair.tracks.artists', 'deadair.tracks.year', 'deadair.albums.name as albumName'])
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

        return this.db
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
            .execute();
    }
}
