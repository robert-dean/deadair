import { Injectable } from 'injectkit';
import { ExpressionBuilder } from 'kysely';
import { DataRepository } from '../data/data.repository.js';
import { DB } from '../data/db.js';
import { CatalogListQuery, columnFor, directionFor, likeContains } from './catalog.query.js';
import { artUrl } from './catalog.art.js';

/**
 * `nameKey` is a match key for ingest and never read out; `artistName` is joined in below.
 *
 * `imageUrl` is not among them: it is selected through {@link artUrl}, which prefers the locally
 * cached copy over the upstream URL the column holds.
 */
const ALBUM_COLUMNS = [
    'deadair.albums.id',
    'deadair.albums.name',
    'deadair.albums.artistId',
    'deadair.albums.mbid',
    'deadair.albums.year',
    'deadair.albums.rating',
    'deadair.artists.name as artistName',
] as const;

/** Database spelling, because {@link artUrl} is raw SQL and reads the column twice. */
const ALBUM_IMAGE_COLUMN = 'deadair.albums.image_url';

function trackCount(eb: ExpressionBuilder<DB, 'deadair.albums' | 'deadair.artists'>) {
    return eb
        .selectFrom('deadair.tracks')
        .select(inner => inner.fn.countAll<number>().as('count'))
        .whereRef('deadair.tracks.albumId', '=', 'deadair.albums.id')
        .where('deadair.tracks.mergedIntoId', 'is', null)
        .as('trackCount');
}

/**
 * What an album list may be ordered by.
 *
 * `tracks` is the alias of the correlated subquery above, already selected. `albums` is absent
 * because an album has no albums, and asking for it gets name order, per {@link columnFor}.
 */
const ALBUM_SORTS = {
    name: 'deadair.albums.name',
    tracks: 'trackCount',
    year: 'deadair.albums.year',
    rating: 'deadair.albums.rating',
} as const;

@Injectable()
export class AlbumsRepository extends DataRepository {
    /**
     * @param artistId - Narrows to one artist's albums. Absent lists the whole catalog.
     */
    async listAlbums(query: CatalogListQuery, artistId?: string) {
        const { limit, offset, sort, search, sortBy } = query;

        // The join is inner because `albums.artist_id` is `not null references artists`, so every
        // album has one. It is not filtered on the artist's own `merged_into_id`: the album points
        // at whichever row it points at, and hiding it because its artist was merged would lose the
        // album rather than move it.
        let scoped = this.db
            .selectFrom('deadair.albums')
            .innerJoin('deadair.artists', 'deadair.artists.id', 'deadair.albums.artistId')
            .where('deadair.albums.mergedIntoId', 'is', null);
        if (artistId !== undefined) {
            scoped = scoped.where('deadair.albums.artistId', '=', artistId);
        }
        if (search !== undefined) {
            scoped = scoped.where('deadair.albums.name', 'ilike', likeContains(search));
        }

        const { total } = await scoped.select(eb => eb.fn.countAll<number>().as('total')).executeTakeFirstOrThrow();
        const data = await scoped
            .select(ALBUM_COLUMNS)
            .select(artUrl(ALBUM_IMAGE_COLUMN))
            .select(eb => [trackCount(eb)])
            .orderBy(columnFor(sortBy, ALBUM_SORTS, ALBUM_SORTS.name), directionFor(sort))
            .orderBy('deadair.albums.id', 'asc')
            .limit(limit)
            .offset(offset)
            .execute();

        return { total: Number(total), data: data.map(countAsNumber) };
    }

    /** Undefined when no such album exists, and equally when it was merged away. */
    async findAlbum(id: string) {
        const row = await this.db
            .selectFrom('deadair.albums')
            .innerJoin('deadair.artists', 'deadair.artists.id', 'deadair.albums.artistId')
            .where('deadair.albums.id', '=', id)
            .where('deadair.albums.mergedIntoId', 'is', null)
            .select(ALBUM_COLUMNS)
            .select(artUrl(ALBUM_IMAGE_COLUMN))
            .select(eb => [trackCount(eb)])
            .executeTakeFirst();

        return row === undefined ? undefined : countAsNumber(row);
    }

    /** What the station thinks of this record, as the column spells it. Merged rows are not rated; see `ArtistsRepository.setRating`. */
    async setRating(id: string, rating: number): Promise<boolean> {
        const result = await this.db
            .updateTable('deadair.albums')
            .set({ rating })
            .where('deadair.albums.id', '=', id)
            .where('deadair.albums.mergedIntoId', 'is', null)
            .executeTakeFirst();

        return (result.numUpdatedRows ?? 0n) > 0n;
    }
}

/**
 * `count(*)` is a bigint, and node-postgres hands bigints back as strings rather than lose
 * precision. Kysely types a scalar subquery as nullable because most of them are; an aggregate
 * over zero rows still returns 0, so the fallback is unreachable rather than a real default.
 */
function countAsNumber<T extends { trackCount: number | null }>(row: T): Omit<T, 'trackCount'> & { trackCount: number } {
    return { ...row, trackCount: Number(row.trackCount ?? 0) };
}
