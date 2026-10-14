import { Injectable } from 'injectkit';
import { ExpressionBuilder, sql } from 'kysely';
import { DataRepository } from '../data/data.repository.js';
import { DB } from '../data/db.js';
import { CatalogListQuery, columnFor, directionFor, likeContains, namesAsAnAct } from './catalog.query.js';
import { artistArtUrl } from './catalog.art.js';
import { withStationCover } from '#modules/art/art.source.token.js';

/**
 * The columns the `Artist` contract carries. `artistKey` is a match key for ingest, never read out.
 *
 * `imageUrl` is not among them: it is selected through {@link artistArtUrl}, which prefers the
 * locally cached copy over the upstream URL the column holds, and an album cover over neither.
 */
const ARTIST_COLUMNS = ['deadair.artists.id', 'deadair.artists.name', 'deadair.artists.mbid', 'deadair.artists.rating'] as const;

/**
 * How many albums and tracks hang off the artist being selected.
 *
 * Correlated subqueries rather than a `group by` over two joins, which would multiply the album
 * rows by the track rows and count both wrong. Each excludes merged rows for the same reason the
 * outer query does: a count that includes rows the list will not show is a count of nothing the
 * operator can click through to.
 */
function albumCount(eb: ExpressionBuilder<DB, 'deadair.artists'>) {
    return eb
        .selectFrom('deadair.albums')
        .select(inner => inner.fn.countAll<number>().as('count'))
        .whereRef('deadair.albums.artistId', '=', 'deadair.artists.id')
        .where('deadair.albums.mergedIntoId', 'is', null)
        .as('albumCount');
}

function trackCount(eb: ExpressionBuilder<DB, 'deadair.artists'>) {
    return eb
        .selectFrom('deadair.tracks')
        .select(inner => inner.fn.countAll<number>().as('count'))
        .whereRef('deadair.tracks.artistId', '=', 'deadair.artists.id')
        .where('deadair.tracks.mergedIntoId', 'is', null)
        .as('trackCount');
}

/**
 * What an artist list may be ordered by.
 *
 * `albumCount` and `trackCount` are the aliases of the two correlated subqueries above, which are
 * already selected, so ordering by them costs the query no second pass over the tables. `year` and
 * the track keys are absent because they are not facts about an artist; asking for one gets name
 * order, per {@link columnFor}.
 */
const ARTIST_SORTS = {
    name: 'deadair.artists.name',
    albums: 'albumCount',
    tracks: 'trackCount',
    rating: 'deadair.artists.rating',
} as const;

@Injectable()
export class ArtistsRepository extends DataRepository {
    /**
     * The artists the library holds whose names appear in `text` as whole words, as written.
     *
     * For reading a brief: "Thrash and groove: Metallica, Megadeth, Slayer" names three acts the
     * station can look up, and nothing else in the sentence has to be parsed to find them. The
     * database narrows by plain containment (`strpos`, which is case-sensitive, as this is) and the
     * whole-word test runs here, because the escaping a name would need inside a SQL regular
     * expression is a second dialect of {@link namesAsAnAct} for no gain: the narrowed set is a
     * handful of rows.
     *
     * **Case-sensitive on purpose.** A brief capitalises the acts it names and not its ordinary
     * words, so "Heavy metal in all its forms, loud" does not name an artist called "Loud". What it
     * cannot tell apart is a name that IS a capitalised word in the brief: an act called "Death"
     * would be found in "Death and black: Obituary". That is one extra record from an artist the
     * operator wrote the word for, and every caller treats these as leads, never as rules.
     *
     * **A whole word inside a longer name is not this act.** "Honey" is a whole word of "Dirty Honey",
     * and finding it put a Polish pop group into a rock show; see {@link namesAsAnAct}.
     *
     * Disliked artists and merged rows are left out. Single characters are too, since a brief's "A"
     * is never an act.
     */
    async namedIn(text: string): Promise<{ name: string; artistKey: string }[]> {
        if (text.trim().length === 0) return [];

        const rows = await this.db
            .selectFrom('deadair.artists')
            .select(['deadair.artists.name', 'deadair.artists.artistKey'])
            .where('deadair.artists.mergedIntoId', 'is', null)
            .where('deadair.artists.rating', '<>', -1)
            .where(sql<boolean>`length(deadair.artists.name) > 1`)
            .where(sql<boolean>`strpos(${text}, deadair.artists.name) > 0`)
            .execute();

        return rows.filter(row => namesAsAnAct(text, row.name)).map(row => ({ name: row.name, artistKey: row.artistKey }));
    }

    async listArtists(query: CatalogListQuery) {
        const { limit, offset, sort, search, sortBy } = query;

        let scoped = this.db.selectFrom('deadair.artists').where('deadair.artists.mergedIntoId', 'is', null);
        if (search !== undefined) {
            scoped = scoped.where('deadair.artists.name', 'ilike', likeContains(search));
        }

        const { total } = await scoped.select(eb => eb.fn.countAll<number>().as('total')).executeTakeFirstOrThrow();
        const data = await scoped
            .select(ARTIST_COLUMNS)
            .select(artistArtUrl())
            .select(eb => [albumCount(eb), trackCount(eb)])
            .orderBy(columnFor(sortBy, ARTIST_SORTS, ARTIST_SORTS.name), directionFor(sort))
            // Names collide, and a paged list whose order is undefined between ties both drops and
            // repeats rows across pages. The id breaks the tie because it is unique. It holds for
            // every sort key, not just the name: a count ties far harder than a name does.
            .orderBy('deadair.artists.id', 'asc')
            .limit(limit)
            .offset(offset)
            .execute();

        return { total: Number(total), data: data.map(row => withStationCover(countsAsNumbers(row), 'imageUrl')) };
    }

    /** Undefined when no such artist exists, and equally when it was merged away: reads never return a merged row. */
    async findArtist(id: string) {
        const row = await this.db
            .selectFrom('deadair.artists')
            .where('deadair.artists.id', '=', id)
            .where('deadair.artists.mergedIntoId', 'is', null)
            .select(ARTIST_COLUMNS)
            .select(artistArtUrl())
            .select(eb => [albumCount(eb), trackCount(eb)])
            .executeTakeFirst();

        return row === undefined ? undefined : withStationCover(countsAsNumbers(row), 'imageUrl');
    }

    /**
     * What the station thinks of this artist, as the column spells it. See `rating.ts`.
     *
     * False when nothing was updated, which covers both an id that is not there and one that was
     * merged away: a merged row is never read out, so it is never rated either — the opinion belongs
     * on the row the catalog actually shows. `updated_at` moves through the table's own trigger.
     */
    async setRating(id: string, rating: number): Promise<boolean> {
        const result = await this.db
            .updateTable('deadair.artists')
            .set({ rating })
            .where('deadair.artists.id', '=', id)
            .where('deadair.artists.mergedIntoId', 'is', null)
            .executeTakeFirst();

        return (result.numUpdatedRows ?? 0n) > 0n;
    }
}

/**
 * `count(*)` is a bigint, and node-postgres hands bigints back as strings rather than lose
 * precision. Kysely types a scalar subquery as nullable because most of them are; an aggregate
 * over zero rows still returns 0, so the fallback is unreachable rather than a real default.
 */
function countsAsNumbers<T extends { albumCount: number | null; trackCount: number | null }>(
    row: T,
): Omit<T, 'albumCount' | 'trackCount'> & { albumCount: number; trackCount: number } {
    return { ...row, albumCount: Number(row.albumCount ?? 0), trackCount: Number(row.trackCount ?? 0) };
}
