-- migrate:up

-- The provider playlists an operator has hidden from this station.
--
-- A provider's playlists are read live and never stored (see `CatalogSyncService` and
-- `PlaylistsService`), and a Spotify listing is everything the account FOLLOWS: a friend's playlist,
-- a list somebody shared once, the editorial ones. Some of those are simply not the station's
-- business, and without somewhere to say so they sit on the Playlists page, in every playlist
-- picker, and in the library sync forever.
--
-- A row here says only "not this one". Nothing about the playlist is copied: its name, its tracks and
-- whether it still exists all stay the provider's answer, read live as before, so a playlist renamed
-- upstream stays hidden under its new name and one deleted upstream leaves an inert row behind.
-- `deadair.playlists` is unrelated and stays the table for playlists deadair itself owns.
--
-- A table rather than a setting, on `0018_topics.sql`'s argument: this is a list an operator adds to
-- from a card and takes back one entry at a time, which is not one row of a form.
create table deadair.hidden_playlists (
    created_at timestamptz not null default now(),
    -- Present for the reason it is on every other station-owned table: the second station is a row
    -- rather than a migration.
    station_key text not null default 'main',
    -- Manifest id of the plugin offering the playlist. A soft reference and never a foreign key, as
    -- everywhere: a plugin is code, not data, and a row naming one that is uninstalled is inert.
    plugin_id text not null,
    -- The provider's own id for the playlist, exactly as `CatalogPlaylist.id` carries it.
    playlist_id text not null,

    -- Hiding twice is one hide, which is what makes the endpoint safe to press again.
    primary key (station_key, plugin_id, playlist_id)
);

-- migrate:down

drop table if exists deadair.hidden_playlists;
