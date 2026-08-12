import { Injectable } from 'injectkit';
import { DataRepository } from '#modules/data/data.repository.js';

/**
 * What the operator has said they like and dislike, as something that can be shown to a model.
 *
 * ## Why this is not `CandidatesRepository.ratingsFor`
 *
 * That one answers "how does the station feel about THESE tracks", which is the question a filter
 * asks: it takes ids and returns the `least(track, album, artist)` those ids resolve to. It is the
 * enforcement path and it stays that.
 *
 * This is the opposite direction. "What has the operator got an opinion about at all" has no input
 * and is a question only a writer of a PROMPT asks — a model cannot be steered by a filter it never
 * sees, and a station that only ever vetoes reads to a listener as a station with no taste. Neither
 * query can be expressed as the other.
 *
 * ## It steers; it does not decide
 *
 * Nothing here is enforcement and nothing here should become it. A model handed these lists may
 * ignore them entirely, and the record it names is still judged in `PickResolver` against the
 * ratings as they stand — which is where a dislike being an INSTRUCTION rather than a preference is
 * expressed. Two consequences worth keeping in mind: this being wrong or stale costs a duller set
 * and never an aired record the operator forbade, and deleting the enforcement because "the model
 * has been told" would be exactly the correctness hole `docs/todo/station-intelligence.md` §1
 * records.
 *
 * ## Bounded, and honest about being bounded
 *
 * Every list has a ceiling and every answer carries the TOTAL, because a truncated list shown as
 * though it were complete is how a station with two hundred liked artists ends up looking like a
 * station with thirty. Ordered by name so the same library produces the same prompt twice; there is
 * no "most recently rated" to order by, since `updated_at` on these rows also moves when enrichment
 * writes to them, and ordering by a column that means something else would be a claim rather than a
 * sort.
 */

/** One artist the operator has an opinion about. */
export interface RatedArtist {
    name: string;
}

/** One record the operator has an opinion about. Its artist is carried because a title alone is ambiguous. */
export interface RatedAlbum {
    title: string;
    artist: string;
}

/** One song the operator has an opinion about, as a picker would name it. */
export interface RatedTrack {
    title: string;
    artist: string;
}

/** One side of the operator's taste: what they said, and how much of it is being shown. */
export interface RatedSet<T> {
    /** Up to the caller's limit, ordered by name. */
    shown: T[];
    /** How many there are in total, which is what says whether `shown` is the whole answer. */
    total: number;
}

/** Everything the operator has said, both ways round. */
export interface StationTaste {
    likedArtists: RatedSet<RatedArtist>;
    dislikedArtists: RatedSet<RatedArtist>;
    likedAlbums: RatedSet<RatedAlbum>;
    dislikedAlbums: RatedSet<RatedAlbum>;
    likedTracks: RatedSet<RatedTrack>;
    dislikedTracks: RatedSet<RatedTrack>;
}

@Injectable()
export class TasteRepository extends DataRepository {
    /**
     * Everything the operator has rated, in one read.
     *
     * Six queries in parallel rather than six round trips, because both callers want the whole
     * picture: a prompt shows several of these lists at once, and a tool answering only the half it
     * was asked for would still be paying for the round trip.
     *
     * @param limit - How many of each to return. The totals are counted regardless.
     */
    async taste(limit: number): Promise<StationTaste> {
        const [likedArtists, dislikedArtists, likedAlbums, dislikedAlbums, likedTracks, dislikedTracks] = await Promise.all([
            this.artists(1, limit),
            this.artists(-1, limit),
            this.albums(1, limit),
            this.albums(-1, limit),
            this.tracks(1, limit),
            this.tracks(-1, limit),
        ]);

        return { likedArtists, dislikedArtists, likedAlbums, dislikedAlbums, likedTracks, dislikedTracks };
    }

    /**
     * Artists at one rating.
     *
     * Merged rows are excluded here as everywhere else: a merged artist is the same act described
     * twice, and the loser's name is the stale half. Showing both would read to a model as two acts
     * the operator feels the same way about.
     */
    private async artists(rating: number, limit: number): Promise<RatedSet<RatedArtist>> {
        const rows = await this.db
            .selectFrom('deadair.artists')
            .select('name')
            .where('rating', '=', rating)
            .where('mergedIntoId', 'is', null)
            .orderBy('name', 'asc')
            .limit(limit)
            .execute();

        return { shown: rows.map(row => ({ name: row.name })), total: await this.count('deadair.artists', rating) };
    }

    private async albums(rating: number, limit: number): Promise<RatedSet<RatedAlbum>> {
        const rows = await this.db
            .selectFrom('deadair.albums')
            .innerJoin('deadair.artists', 'deadair.artists.id', 'deadair.albums.artistId')
            .select(['deadair.albums.name as title', 'deadair.artists.name as artist'])
            .where('deadair.albums.rating', '=', rating)
            .where('deadair.albums.mergedIntoId', 'is', null)
            .orderBy('deadair.albums.name', 'asc')
            .limit(limit)
            .execute();

        return { shown: rows.map(row => ({ title: row.title, artist: row.artist })), total: await this.count('deadair.albums', rating) };
    }

    /**
     * Songs at one rating, credited to the artist identity rather than to the release's credit line.
     *
     * `artists.name` and not `tracks.artists`, matching how every rotation key in this codebase is
     * built: identity is taken from the lead artist, and a prompt that showed "feat." credits would
     * be showing a model names it cannot search on.
     */
    private async tracks(rating: number, limit: number): Promise<RatedSet<RatedTrack>> {
        const rows = await this.db
            .selectFrom('deadair.tracks')
            .innerJoin('deadair.artists', 'deadair.artists.id', 'deadair.tracks.artistId')
            .select(['deadair.tracks.title', 'deadair.artists.name as artist'])
            .where('deadair.tracks.rating', '=', rating)
            .where('deadair.tracks.mergedIntoId', 'is', null)
            .orderBy('deadair.tracks.title', 'asc')
            .limit(limit)
            .execute();

        return { shown: rows.map(row => ({ title: row.title, artist: row.artist })), total: await this.count('deadair.tracks', rating) };
    }

    /** How many rows carry this rating, whatever the limit showed. */
    private async count(table: 'deadair.artists' | 'deadair.albums' | 'deadair.tracks', rating: number): Promise<number> {
        const row = await this.db
            .selectFrom(table)
            .select(eb => eb.fn.countAll<string>().as('total'))
            .where('rating', '=', rating)
            .where('mergedIntoId', 'is', null)
            .executeTakeFirst();

        return Number(row?.total ?? 0);
    }
}
