import { sql, type ExpressionBuilder, type RawBuilder } from 'kysely';
import type { DB } from '../data/db.js';

/**
 * Whether a track has any credited artist the operator has disliked, lead or guest.
 *
 * A dislike is an instruction about the ARTIST, and `deadair.track_artists` is what makes a station's
 * "no more of them" true for a record they only guest on: "Y feat. X" credits X on `track_artists`
 * even though `tracks.artist_id` still names Y as the lead. Reading only the lead column (which is
 * what {@link CandidatesRepository.effectiveRating} and every predicate in `tracks.repository.ts` did
 * before this file existed) let a disliked artist straight back onto the air the moment somebody
 * else's name was first on the credit.
 *
 * **The other direction does not hold, and that asymmetry is deliberate.** A LIKE is "play more of
 * this act", and a guest slot on somebody else's record is not more of the guest's own work: it is
 * one bar, one verse, one feature. Letting a guest's like raise a lead's record would make disliking
 * nobody and liking one collaborator a way to promote every record that act ever appeared on.
 * `effectiveRating`'s `greatest()` (the like half) stays reading `deadair.artists.rating` for the
 * LEAD alone; only the veto half reaches through this join.
 *
 * Two forms because the two callers speak two different SQL dialects. `noCreditedDislike` is a Kysely
 * predicate for a query built with the expression builder: `CandidatesRepository.sample` and the
 * `TracksRepository` reads that already carry `deadair.tracks`, `deadair.artists` and
 * `deadair.albums` in scope. {@link creditedDislikeExists} is the same subquery as a raw `sql`
 * fragment, for `effectiveRating` (which computes with `sql.join` over raw column refs) and
 * `styleVocabulary` (which is raw throughout because it walks two jsonb payloads no Kysely builder
 * has an expression for), both name the track id differently, so the fragment takes that reference
 * as a parameter rather than assuming a table name.
 */
export const noCreditedDislike = (eb: ExpressionBuilder<DB, 'deadair.tracks' | 'deadair.artists' | 'deadair.albums'>) =>
    eb.not(
        eb.exists(
            eb
                .selectFrom('deadair.trackArtists as ta')
                .innerJoin('deadair.artists as ca', 'ca.id', 'ta.artistId')
                .select('ta.trackId')
                .whereRef('ta.trackId', '=', 'deadair.tracks.id')
                .where('ca.rating', '=', -1),
        ),
    );

/**
 * {@link noCreditedDislike}'s subquery, as a raw fragment that answers `exists` rather than `not
 * exists`: callers that need the negative wrap it themselves (`and not ${...}`), and
 * `effectiveRating` wants the positive form directly, to fold into a `case`.
 *
 * @param trackId - How the caller's SQL names the track's id: `sql.ref('deadair.tracks.id')` for an
 *   unaliased read, `` sql`t.id` `` for one that already aliased the table.
 */
export const creditedDislikeExists = (trackId: RawBuilder<unknown>) => sql<boolean>`exists (
    select 1
    from deadair.track_artists ta
    inner join deadair.artists ca on ca.id = ta.artist_id
    where ta.track_id = ${trackId} and ca.rating = -1
)`;
