import { sql } from 'kysely';
import { creditedDislikeExists } from './credited.dislike.js';

/**
 * How the station feels about one work, as one number: `-1`, `0` or `1`.
 *
 * An opinion is held at three levels and inherits DOWNWARD in both directions, which is why this is
 * not a plain `least()` over the three columns:
 *
 * - **A dislike anywhere wins, absolutely.** Disliking an artist stops the station playing them,
 *   whatever any one of their songs says. That is an instruction rather than a preference, and it
 *   is why the veto is taken first.
 * - **Otherwise the strongest like wins.** Liking an artist means play more of them, and liking one
 *   song means play that song more; neither should need the other two levels to agree before it
 *   counts for anything.
 *
 * The `least()` this replaces got the first half right and silently swallowed the second: a liked
 * song on an unrated record by an unrated artist came out as `0`, so `weightOf` (director/rotation.rules.ts) never doubled
 * anything unless all three levels had been rated the same way. Liking a record did nothing at all,
 * which made the whole positive half of the console's rating control decorative.
 *
 * An album is `coalesce(…, 0)` because `tracks.album_id` is nullable: a single ingested outside any
 * release has no record to have an opinion about, and that is "no opinion" rather than a missing
 * one.
 *
 * A fourth term folds into the `least()` alone: a track any credited artist is disliked on, lead or
 * guest, veto's the same way the three stored columns do. It is not a fourth column because there is
 * no fourth rating to read: `noCreditedDislike`'s doc comment says why the like half, `greatest()`,
 * does not gain the same term: a guest's like is not more of the guest, so it must not raise a
 * record it only appears on.
 *
 * It lives in the catalog because two modules read it: the director's draw and resolver, and the
 * station's own chart, which leaves out what the station has disliked and lifts what it likes. Two
 * copies of this expression would be two ideas of what the station thinks of a record.
 *
 * The query it is used in must join `deadair.tracks`, `deadair.artists` on the lead artist and
 * `deadair.albums` (left), under those names.
 */
const RATING_COLUMNS = [sql.ref('deadair.tracks.rating'), sql`coalesce(${sql.ref('deadair.albums.rating')}, 0)`, sql.ref('deadair.artists.rating')];

export const effectiveRating = () => sql<number>`case
    when least(${sql.join(RATING_COLUMNS)}, case when ${creditedDislikeExists(sql.ref('deadair.tracks.id'))} then -1 else 0 end) = -1 then -1
    else greatest(${sql.join(RATING_COLUMNS)})
end`;
