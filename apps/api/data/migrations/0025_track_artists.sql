-- migrate:up

-- Every artist credited on a record, not only the lead.
--
-- `tracks.artists` stays the display line exactly as the provider wrote it ("Display credit as
-- written on the release ... not a join key", 0005_music.sql) and `tracks.artist_id` stays the
-- lead. Nothing here changes either. This table exists so a guest on a record is a row a dislike
-- can reach: today the only artist a track resolves to is `artists[0]`, so a listener who never
-- wants to hear a featured rapper again has no row to dislike, only the headliner's.
--
-- No `updated_at`, and no trigger: a credit is never corrected in place, only re-derived. The next
-- sync walk writes the row set a provider currently reports and leaves what is already there,
-- `on conflict do nothing` on the pair below, so a credit dropped from a later release is a row
-- this table keeps rather than a row it deletes: nothing here ever needs `deleted_at` either,
-- because nothing here is ever removed.
--
-- No unique constraint on `position` alone: providers reorder credits between walks (a
-- featured artist promoted to co-lead, or the reverse), so two rows may briefly claim the same
-- position for the same track. The primary key is `(track_id, artist_id)`, which is the fact that
-- actually must not duplicate.
--
-- A guest who has never opened a record here gets an `artists` row with `rating` at its column
-- default of 0, the same as any other newly discovered artist. That is the point, not a gap to
-- close: the row is what makes the artist nameable to a dislike, and the rating starts neutral
-- like every other artist's does.
create table deadair.track_artists (
    created_at timestamptz not null default now(),
    track_id uuid not null references deadair.tracks (id) on delete cascade,
    artist_id uuid not null references deadair.artists (id) on delete cascade,
    -- Credit order as the provider gave it, from 0 (lead). Matches `tracks.artist_id`, which is
    -- always the position-0 row here.
    position smallint not null check (position >= 0),
    primary key (track_id, artist_id)
);

-- The read a dislike needs: every track one artist is credited on, guest or lead.
create index track_artists_artist_idx on deadair.track_artists (artist_id);

-- Backfill: every existing track's lead is already known, so seed it rather than leave the join
-- empty until the next sync walk revisits every record in the library.
insert into deadair.track_artists (track_id, artist_id, position)
select id, artist_id, 0 from deadair.tracks;

-- migrate:down

drop table if exists deadair.track_artists;
