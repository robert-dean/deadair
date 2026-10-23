import { sql, type RawBuilder } from 'kysely';

/**
 * Whether a record is suspended right now: the record itself, its release, its lead artist, or any
 * artist credited on it, has a `suspended_until` still in the future.
 *
 * A suspension is "stop considering this until then", and it is enforced wherever a dislike is, by
 * the same reads and never beside them: every query that keeps a disliked record off the air puts
 * `not ${suspendedNow(...)}` next to its rating clauses. It reaches through `track_artists` for the
 * dislike's reason (`credited.dislike.ts`): an artist suspended for a week is not back on the air on
 * somebody else's record as a guest.
 *
 * Read against `now()` at the point of use, so a lapsed suspension is simply no longer one. Nothing
 * sweeps it. See migration 0115.
 *
 * One raw form for every caller, Kysely-built and raw alike, because both dialects can take a
 * boolean SQL fragment and two forms of one rule are two things to keep in step.
 *
 * @param trackId - How the caller's SQL names the track's id: `sql.ref('deadair.tracks.id')` for an
 *   unaliased read, `` sql`t.id` `` for one that already aliased the table.
 */
export const suspendedNow = (trackId: RawBuilder<unknown>) => sql<boolean>`(
    exists (
        select 1
        from deadair.tracks st
        inner join deadair.artists sa on sa.id = st.artist_id
        left join deadair.albums sal on sal.id = st.album_id
        where st.id = ${trackId}
          and (st.suspended_until > now() or sa.suspended_until > now() or sal.suspended_until > now())
    )
    or exists (
        select 1
        from deadair.track_artists ta
        inner join deadair.artists ca on ca.id = ta.artist_id
        where ta.track_id = ${trackId} and ca.suspended_until > now()
    )
)`;

/** {@link suspendedNow} negated, for the `where` beside the rating clauses. */
export const notSuspendedNow = (trackId: RawBuilder<unknown>) => sql<boolean>`not ${suspendedNow(trackId)}`;

/**
 * Whether an ARTIST is suspended right now, for the reads that answer by artist rather than by record.
 *
 * `coalesce`, because `null > now()` is null rather than false, and a negated null drops the row:
 * every artist never suspended would vanish from a read that asked for the ones that are not.
 */
export const artistSuspendedNow = (column: RawBuilder<unknown>) => sql<boolean>`coalesce(${column} > now(), false)`;
