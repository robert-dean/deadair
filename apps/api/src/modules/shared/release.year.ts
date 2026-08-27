import { sql } from 'kysely';

/**
 * Which year a record belongs to, as one expression every period surface shares.
 *
 * The station holds the same fact at two levels: `deadair.tracks.year` and `deadair.albums.year`,
 * each written at ingest from whatever the provider sent with the payload that created the row, and
 * neither ever overwritten. That last part is what makes this a judgement rather than a read — a
 * record is dated by whichever RELEASE it was first seen through, so a track first met on a
 * compilation carries the compilation's year for good while its own album row, filled later by
 * another track, carries the original's.
 *
 * **So the EARLIER of the two claims wins, rather than the more specific one.** It was
 * `coalesce(track, album)` — the track's claim preferred as the narrower one — and that reading is
 * wrong in exactly the direction a period filter cannot afford. Measured on this station's library
 * (766 tracks, 630 albums, ingested from one provider): 41 records carry a track year and an album
 * year that disagree, and 33 of those have the TRACK dated later. Every one sampled was a reissue or
 * a compilation sitting on top of an original the album row had right — `All Along the Watchtower`
 * dated 2023 against `Electric Ladyland` at 1968, `Purple Haze` at 1993 against `Are You
 * Experienced` at 1967, `Tiny Dancer` at 1989 against `Madman Across The Water` at 1971. Under the
 * old expression all 33 answered with the reissue's year, which is a station asked for the
 * seventies quietly refusing its own Hendrix.
 *
 * The 8 in the other direction are the same failure seen from the other side and are already right
 * under this rule: `The Power Of Love` at 1985 on a `Greatest Hits` album dated 2006 keeps 1985.
 *
 * **The counterexample is a bogus LOW claim, and it is bounded where reissue skew is not.** One
 * album in that library carries 1900 — the floor `usableYear` accepts — so its two tracks now read
 * as 1900 records where before the track's own 2007 covered for it. That is the honest trade: a
 * too-early year is a data error with a validated floor underneath it, and a too-late one is the
 * normal, unmarked shape of every remaster a provider sells.
 *
 * `least` and not `min`: Postgres's `least` IGNORES nulls and answers null only when every argument
 * is null, which is exactly the three cases wanted — one claim, the other claim, or genuinely no
 * year at all. **A null answer means the catalog does not know**, and every caller reads that as
 * eligible for any period. See `CandidatesRepository.withinPeriod` for the other half of that rule.
 *
 * Both columns have to be in scope, so a query using this must join `deadair.albums` (a `leftJoin`,
 * or a track with no album row drops out of the result entirely).
 */
export const releasedYear = sql<number | null>`least(deadair.tracks.year, deadair.albums.year)`;
