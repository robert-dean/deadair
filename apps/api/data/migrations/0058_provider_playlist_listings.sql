-- migrate:up

-- The last complete list of playlists each music source offered, as the library sync read it.
--
-- The Library page used to ask every provider for its playlists live, on every visit, with the
-- plugin's per-call timeout between the operator and the page. A slow or rate-limited provider then
-- showed NOTHING, although the hourly sync had walked the very same list minutes before and thrown
-- it away. The sync is now the one writer of this table and the page reads it, so an upstream having
-- a bad minute costs the page its freshness rather than its contents.
--
-- One row per plugin holding the whole listing, not one row per playlist, because a listing is only
-- ever read and replaced whole: it is a snapshot of one answer, and a row per playlist would make
-- "replace it only when the new walk finished" a delete plus an insert that has to agree with itself.
--
-- This is still the PROVIDER's list and not the station's. `deadair.playlists` stays the table for
-- playlists deadair owns; nothing here is importable, editable or aired from this table, and a
-- playlist renamed upstream is renamed here at the next walk. Whether an operator hid one stays in
-- `deadair.hidden_playlists` and is applied when the listing is read, so hiding one never waits on a
-- walk.
create table deadair.provider_playlist_listings (
    -- Present for the reason it is on every other station-owned table.
    station_key text not null default 'main',
    -- Manifest id of the plugin that answered. A soft reference, as everywhere: a row for a plugin
    -- that has been uninstalled is inert, because the page only reads rows for plugins it can see.
    plugin_id text not null,
    -- When the walk that produced this listing finished reading it. The console shows its age.
    listed_at timestamptz not null default now(),
    -- The provider's playlists, in the provider's order, each as the plugin SDK's `ProviderPlaylist`.
    playlists jsonb not null check (jsonb_typeof(playlists) = 'array'),

    primary key (station_key, plugin_id)
);

-- migrate:down

drop table if exists deadair.provider_playlist_listings;
