import { Injectable } from 'injectkit';
import { DataRepository } from '../data/data.repository.js';
import { CatalogListQuery, likeContains } from './catalog.query.js';

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
            .orderBy('deadair.tracks.title', sort)
            .orderBy('deadair.tracks.id', 'asc')
            .limit(limit)
            .offset(offset)
            .execute();

        return { total: Number(total), data };
    }
}
