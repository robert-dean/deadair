-- migrate:up

-- The music catalog is split on two axes.
--
--   artists / albums / tracks       the work. One row per real-world thing, regardless of
--                                   how many providers happen to carry it. Ratings,
--                                   playlists and enrichment hang off these ids, so they
--                                   survive swapping a provider out.
--   *_sources                       the binding. One row per (provider, provider id) that
--                                   can serve the work. A track legitimately has several:
--                                   two Navidrome files plus a Spotify id is normal.
--   *_enrichment                    what an external metadata provider knows about the
--                                   work. Different axis from *_sources: Spotify appears
--                                   in both, with different rows.
--
-- Ingest resolves an incoming item to a canonical row (mbid, then isrc for tracks, then
-- the fuzzy *_key columns) and writes a binding. Playout resolves the other way: canonical
-- track -> best available binding, by the operator's source preference order.

create table deadair.artists (
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now() check (updated_at >= created_at),
    id uuid not null default gen_random_uuid() primary key,
    artist_key text not null unique,
    name text not null,
    -- MusicBrainz artist id. Null until enrichment resolves one.
    mbid uuid unique,
    image_url text,
    rating integer not null default 0 constraint artists_rating_check check (rating in (-1, 0, 1)),
    -- Set when this row turns out to duplicate another. Reads filter on null and follow
    -- the pointer, so a bad match is undone without breaking anything referencing the id.
    merged_into_id uuid references deadair.artists (id) constraint artists_merge_self_check check (merged_into_id <> id)
);
select deadair.add_updated_at_trigger('deadair.artists');
create index artists_merged_into_idx on deadair.artists (merged_into_id) where merged_into_id is not null;

create table deadair.albums (
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now() check (updated_at >= created_at),
    id uuid not null default gen_random_uuid() primary key,
    artist_id uuid not null references deadair.artists (id),
    name text not null,
    name_key text not null,
    -- MusicBrainz release-group id.
    mbid uuid unique,
    year integer,
    image_url text,
    rating integer not null default 0 constraint albums_rating_check check (rating in (-1, 0, 1)),
    merged_into_id uuid references deadair.albums (id) constraint albums_merge_self_check check (merged_into_id <> id)
);
select deadair.add_updated_at_trigger('deadair.albums');
create unique index albums_artist_name_key_idx on deadair.albums (artist_id, name_key);
create index albums_merged_into_idx on deadair.albums (merged_into_id) where merged_into_id is not null;

create table deadair.tracks (
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now() check (updated_at >= created_at),
    id uuid not null default gen_random_uuid() primary key,
    artist_id uuid not null references deadair.artists (id),
    album_id uuid references deadair.albums (id),
    -- Display credit as written on the release ("Artist feat. Other"), not a join key.
    artists text not null,
    title text not null,
    title_key text not null,
    -- MusicBrainz recording id: the resolved identity of this row, as opposed to the
    -- per-provider ids in track_sources and the fetch-time refs in track_enrichment.
    -- Stays null on a station that runs no MusicBrainz enrichment; the resolver must
    -- degrade to isrc and then to the fuzzy keys rather than depend on it.
    mbid uuid unique,
    genre text,
    year integer,
    -- Nominal duration of the recording. Each binding carries the duration of its own copy.
    duration_ms integer,
    rating integer not null default 0 constraint tracks_rating_check check (rating in (-1, 0, 1)),
    merged_into_id uuid references deadair.tracks (id) constraint tracks_merge_self_check check (merged_into_id <> id)
);
select deadair.add_updated_at_trigger('deadair.tracks');
create index tracks_artist_title_key_idx on deadair.tracks (artist_id, title_key);
create index tracks_title_key_idx on deadair.tracks (title_key);
create index tracks_merged_into_idx on deadair.tracks (merged_into_id) where merged_into_id is not null;

create table deadair.artist_sources (
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now() check (updated_at >= created_at),
    id uuid not null default gen_random_uuid() primary key,
    artist_id uuid not null references deadair.artists (id) on delete cascade,
    -- Plugin id of the provider ('spotify', 'navidrome'). Text, not an enum: providers
    -- arrive as plugins and the schema must not need a migration to learn a new one.
    source text not null,
    source_id text not null,
    uri text,
    image_url text,
    raw jsonb,
    last_seen_at timestamptz,
    missing_at timestamptz
);
select deadair.add_updated_at_trigger('deadair.artist_sources');
create unique index artist_sources_source_id_idx on deadair.artist_sources (source, source_id);
create index artist_sources_artist_idx on deadair.artist_sources (artist_id, source);

create table deadair.album_sources (
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now() check (updated_at >= created_at),
    id uuid not null default gen_random_uuid() primary key,
    album_id uuid not null references deadair.albums (id) on delete cascade,
    source text not null,
    source_id text not null,
    uri text,
    -- Provider-scoped art handle. Only meaningful to the provider that issued it.
    cover_art_id text,
    raw jsonb,
    last_seen_at timestamptz,
    missing_at timestamptz
);
select deadair.add_updated_at_trigger('deadair.album_sources');
create unique index album_sources_source_id_idx on deadair.album_sources (source, source_id);
create index album_sources_album_idx on deadair.album_sources (album_id, source);

create table deadair.track_sources (
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now() check (updated_at >= created_at),
    id uuid not null default gen_random_uuid() primary key,
    track_id uuid not null references deadair.tracks (id) on delete cascade,
    source text not null,
    source_id text not null,
    uri text,
    -- False when the provider still knows the track but will not serve it here
    -- (regional restriction, unplayable relink, tombstoned file).
    playable boolean not null default true,
    -- This copy's actual duration, which drifts from the canonical one across rips.
    duration_ms integer,
    bitrate integer,
    format text,
    -- What this provider claims the ISRC is: Spotify from its catalog, Navidrome from
    -- the file tags. Per binding rather than per track because a reissue carries a fresh
    -- ISRC for the same recording and providers disagree, so a single canonical column
    -- would just hold whichever wrote last. The resolver reads these across bindings.
    isrc text,
    cover_art_id text,
    raw jsonb,
    last_seen_at timestamptz,
    missing_at timestamptz
);
select deadair.add_updated_at_trigger('deadair.track_sources');
-- Deliberately (source, source_id) and not (track_id, source): one canonical track may
-- bind to several copies within the same provider.
create unique index track_sources_source_id_idx on deadair.track_sources (source, source_id);
create index track_sources_track_idx on deadair.track_sources (track_id, source);
create index track_sources_isrc_idx on deadair.track_sources (isrc) where isrc is not null;
create index track_sources_playable_idx on deadair.track_sources (track_id) where playable and missing_at is null;

create table deadair.artist_enrichment (
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now() check (updated_at >= created_at),
    id uuid not null default gen_random_uuid() primary key,
    artist_id uuid not null references deadair.artists (id) on delete cascade,
    -- Metadata provider ('musicbrainz', 'lastfm', 'discogs'). Kept per provider so two
    -- fetches never overwrite each other and each can carry its own TTL.
    provider text not null,
    -- The id this payload was fetched under, which can be stale, a redirect, or one that
    -- later proved wrong. For MusicBrainz it will usually equal artists.mbid but is not
    -- derived from it: mbid is the accepted identity, this is fetch provenance. Write both.
    provider_ref text,
    data jsonb not null,
    fetched_at timestamptz not null default now(),
    expires_at timestamptz,
    constraint artist_enrichment_provider_key unique (artist_id, provider)
);
select deadair.add_updated_at_trigger('deadair.artist_enrichment');

create table deadair.album_enrichment (
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now() check (updated_at >= created_at),
    id uuid not null default gen_random_uuid() primary key,
    album_id uuid not null references deadair.albums (id) on delete cascade,
    provider text not null,
    -- Fetch provenance, not identity. See artist_enrichment.provider_ref.
    provider_ref text,
    data jsonb not null,
    fetched_at timestamptz not null default now(),
    expires_at timestamptz,
    constraint album_enrichment_provider_key unique (album_id, provider)
);
select deadair.add_updated_at_trigger('deadair.album_enrichment');

create table deadair.track_enrichment (
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now() check (updated_at >= created_at),
    id uuid not null default gen_random_uuid() primary key,
    track_id uuid not null references deadair.tracks (id) on delete cascade,
    provider text not null,
    -- Fetch provenance, not identity. See artist_enrichment.provider_ref.
    provider_ref text,
    data jsonb not null,
    fetched_at timestamptz not null default now(),
    expires_at timestamptz,
    constraint track_enrichment_provider_key unique (track_id, provider)
);
select deadair.add_updated_at_trigger('deadair.track_enrichment');

create table deadair.playlists (
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now() check (updated_at >= created_at),
    id uuid not null default gen_random_uuid() primary key,
    name text not null,
    prompt text not null default ''
);
select deadair.add_updated_at_trigger('deadair.playlists');

-- References the canonical track, never a binding, so a playlist built while Spotify was
-- the only provider still resolves once the same tracks exist locally.
create table deadair.playlist_tracks (
    id uuid not null default gen_random_uuid() primary key,
    playlist_id uuid not null references deadair.playlists (id),
    track_id uuid not null references deadair.tracks (id),
    position integer not null,
    constraint playlist_tracks_playlist_id_track_id_key unique (playlist_id, track_id),
    constraint playlist_tracks_playlist_id_position_key unique (playlist_id, position)
);


-- migrate:down

drop table deadair.playlist_tracks;
drop table deadair.playlists;
drop table deadair.track_enrichment;
drop table deadair.album_enrichment;
drop table deadair.artist_enrichment;
drop table deadair.track_sources;
drop table deadair.album_sources;
drop table deadair.artist_sources;
drop table deadair.tracks;
drop table deadair.albums;
drop table deadair.artists;
