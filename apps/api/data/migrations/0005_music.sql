-- migrate:up

-- The music catalog is split on three axes.
--
--   artists / albums / tracks       the work. One row per real-world thing, regardless of
--                                   how many providers happen to carry it. Ratings,
--                                   playlists and enrichment hang off these ids, so they
--                                   survive swapping a provider out.
--   *_sources                       the binding. One row per (plugin_id, external_id)
--                                   that can serve the work. A track legitimately has
--                                   several: two Navidrome files plus a Spotify id.
--   *_enrichment                    what an external metadata provider knows about the
--                                   work. Different axis from *_sources: Spotify appears
--                                   in both, with different rows.
--   track_analysis                  what the AUDIO measures, as opposed to what the work
--                                   is or who will serve it. Computed from samples rather
--                                   than fetched, so unlike *_enrichment there is one
--                                   answer and nothing to merge.
--
-- Ingest resolves an incoming item to a canonical row (mbid, then for tracks the isrc
-- claimed by any existing binding, then the fuzzy *_key columns) and writes a binding.
-- Playout resolves the other way: canonical track -> best available binding, by the
-- operator's plugin preference order.

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
    -- Manifest id of the providing plugin ('spotify', 'navidrome'). Text, not an enum:
    -- providers arrive as plugins and the schema must not need a migration to learn one.
    --
    -- Deliberately NOT a foreign key to deadair.plugin_configs, matching plugin_storage.
    -- That table is a sparse config overlay, not a plugin registry: rows appear lazily on
    -- the first write, so a freshly installed plugin that is scanning has no row yet and
    -- an FK would reject its first insert. The registry of installed plugins is in memory
    -- (PluginRegistry, from discover()). The catalog also has to outlive the config, so
    -- disabling a plugin leaves its bindings in place, unplayable, rather than cascading
    -- them away and forcing a full rescan on re-enable.
    plugin_id text not null,
    -- The provider's own opaque handle for the item.
    external_id text not null,
    uri text,
    image_url text,
    raw jsonb,
    last_seen_at timestamptz,
    missing_at timestamptz
);
select deadair.add_updated_at_trigger('deadair.artist_sources');
create unique index artist_sources_plugin_external_idx on deadair.artist_sources (plugin_id, external_id);
create index artist_sources_artist_idx on deadair.artist_sources (artist_id, plugin_id);

create table deadair.album_sources (
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now() check (updated_at >= created_at),
    id uuid not null default gen_random_uuid() primary key,
    album_id uuid not null references deadair.albums (id) on delete cascade,
    -- Soft reference. See artist_sources.plugin_id.
    plugin_id text not null,
    external_id text not null,
    uri text,
    -- Provider-scoped art handle. Only meaningful to the provider that issued it.
    cover_art_id text,
    raw jsonb,
    last_seen_at timestamptz,
    missing_at timestamptz
);
select deadair.add_updated_at_trigger('deadair.album_sources');
create unique index album_sources_plugin_external_idx on deadair.album_sources (plugin_id, external_id);
create index album_sources_album_idx on deadair.album_sources (album_id, plugin_id);

create table deadair.track_sources (
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now() check (updated_at >= created_at),
    id uuid not null default gen_random_uuid() primary key,
    track_id uuid not null references deadair.tracks (id) on delete cascade,
    -- Soft reference. See artist_sources.plugin_id.
    plugin_id text not null,
    external_id text not null,
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
    missing_at timestamptz,
    -- How this copy was found, which decides whether the sync's missing sweep may judge it.
    --
    --   sync        seen while walking the provider's playlists, which is the only enumeration
    --               path a provider offers. The sweep marks whatever a clean walk did not see.
    --   discovered  looked up by name because something chose this record, and ingested on the
    --               spot. It is in no playlist, so a walk will never see it and the sweep would
    --               bench it within an hour of it being found.
    --
    -- The sweep is an argument about what a PLAYLIST WALK saw, and a binding that was never
    -- advertised by a playlist cannot be judged by it. What does judge a discovered copy is
    -- fetching it: four consecutive failures set `missing_at` through
    -- `TracksRepository.markBindingMissing`, which is the mechanism that actually knows.
    --
    -- A discovered copy that later turns up in a playlist is re-marked `sync` by the upsert, so it
    -- rejoins the sweep rather than being exempt for good.
    origin text not null default 'sync' constraint track_sources_origin_check check (origin in ('sync', 'discovered')),
    -- The parental advisory this COPY carries, as the provider reports it. Per binding rather
    -- than per track for the same reason isrc is: a clean edit and the explicit original are two
    -- copies of one work, and they collapse to a single deadair.tracks row (resolveTrack matches
    -- on title_key + artist, and the clean edit's own isrc misses). So the binding is the version,
    -- and preferring one over the other is binding selection.
    --
    --   explicit  the provider says this copy is marked
    --   clean     the provider says it is not
    --   null      the provider did not say
    --
    -- Nullable is load-bearing and is NOT "clean". Subsonic has no such field, so a library from
    -- one is entirely null, and a station set to clean-only demands a positive 'clean' rather than
    -- reading silence as consent. See CandidatesRepository.bindingsFor.
    --
    -- Named for the LABEL rather than the words: nothing here has read a lyric, and `lyrics` stays
    -- reserved for the text should anything ever fetch it.
    advisory text constraint track_sources_advisory_check check (advisory in ('explicit', 'clean'))
);
select deadair.add_updated_at_trigger('deadair.track_sources');
-- Deliberately (plugin_id, external_id) and not (track_id, plugin_id): one canonical
-- track may bind to several copies within the same provider.
create unique index track_sources_plugin_external_idx on deadair.track_sources (plugin_id, external_id);
create index track_sources_track_idx on deadair.track_sources (track_id, plugin_id);
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
    -- What a failed ATTEMPT leaves behind, and the reason it is not what a miss leaves behind.
    --
    -- "Outstanding" means no unexpired row, so a failure that writes nothing is indistinguishable
    -- from a subject nobody has ever asked about: it comes round again on the very next pass, and
    -- an upstream that will never answer is re-asked forever against a one-request-per-second
    -- limiter. Measured: 47 albums, every pass, for as long as the wrong id had been on them.
    --
    -- Recording it as a MISS instead would stop the loop and buy it with a lie — a miss is the
    -- provider answering "nothing", this is the provider not answering, and those are opposite
    -- facts about whether anything is known. The contract says so in as many words.
    --
    -- So: consecutive failures, counted the way deadair.track_audio counts them and reset the same
    -- way by the next answer, with expires_at doing the backoff. One gate rather than a second
    -- clock beside it, because the walk already asks exactly that column when it decides who to ask.
    attempts integer not null default 0,
    last_error text,
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
    -- A remembered failure. See artist_enrichment.attempts.
    attempts integer not null default 0,
    last_error text,
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
    -- A remembered failure. See artist_enrichment.attempts.
    attempts integer not null default 0,
    last_error text,
    constraint track_enrichment_provider_key unique (track_id, provider)
);
select deadair.add_updated_at_trigger('deadair.track_enrichment');

-- What the audio itself measures: where the record actually starts, where it is underway,
-- where the ending begins, where it stops. The third axis in the header comment.
--
-- ONE row per track, where the *_enrichment tables beside it are one per provider. That is
-- the whole structural difference and it comes from the same fact: nobody sells these
-- numbers. Every catalog upstream returns tempo, key and energy; none returns an ending, a
-- downbeat grid or a beat confidence. So this is computed locally from samples, there is
-- one answer, and there is nothing to merge or to order by priority.
--
-- `data` rather than typed columns, following track_enrichment. Analysis output changes
-- shape as detectors improve, and `schema_version` is what lets a row written by an older
-- one read as STALE rather than as missing or -- worse -- as current: the queue query picks
-- up anything below the version the host currently knows, so reanalysis is an ordinary pass
-- instead of a migration. That is also what lets the deferred beat layer (bpm, downbeats,
-- a vocal curve; docs/todo/track-analysis.md) land with no schema change at all.
--
-- `complete` is load-bearing and cannot be checked here or by the app. Whatever decodes the
-- audio fetches it itself, so a byte-capped or interrupted download produces perfectly
-- confident measurements of a file that was never the track, and the specific lie it tells
-- is that a record which fades ended cold. The analyzer reports it; a false answer here
-- silently disables the check, which is why reads filter on it rather than trusting the row.
--
-- `failed_at` / `failure_reason` have no equivalent on the enrichment tables because the
-- cost is not the same. A missing enrichment row is retried cheaply against a rate-limited
-- upstream; a missing analysis row is a full decode, so a track that cannot be measured has
-- to record that fact or every pass pays for it again forever.
create table deadair.track_analysis (
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now() check (updated_at >= created_at),
    id uuid not null default gen_random_uuid() primary key,
    -- Unique, unlike the *_enrichment tables: one analyzer, one answer.
    track_id uuid not null unique references deadair.tracks (id) on delete cascade,
    -- The measurements, in the shape schema_version names. Absolute offsets into the file in
    -- integer milliseconds, cue_out included -- everything downstream seeks in file time, so
    -- a figure stored relative to cue_in would have to be re-based at every read, and one
    -- read eventually would not.
    data jsonb not null default '{}'::jsonb,
    schema_version integer not null,
    complete boolean not null default false,
    -- Which plugin's analyzer produced this, for attribution when a detector turns out to
    -- have been wrong about a class of records. Soft reference, as everywhere. See
    -- artist_sources.plugin_id.
    analyzer_plugin_id text,
    -- Free-text name and version of the analyzer itself, which is not the plugin: the plugin
    -- is an adapter and the thing doing the measuring sits behind it and versions separately.
    analyzer text,
    analyzed_at timestamptz,
    failed_at timestamptz,
    failure_reason text,
    -- A row records a measurement or a failure, never both and never neither. Without this a
    -- retried track that succeeds can keep its old failure and read as broken forever.
    constraint track_analysis_outcome_check check (
        (analyzed_at is not null and failed_at is null) or (failed_at is not null and analyzed_at is null)
    )
);
select deadair.add_updated_at_trigger('deadair.track_analysis');
-- The queue query's index: everything not measured at the current schema version. Partial on
-- the failure column because a track that failed is retried on its own much slower schedule,
-- not on the every-pass walk this serves.
create index track_analysis_stale_idx on deadair.track_analysis (schema_version) where failed_at is null;

-- A playlist deadair owns: canonical track ids plus the station intent in `prompt`. A
-- provider's own playlists are never rows here. They are read live and pass through as
-- CatalogPlaylist (PlaylistsService), so every row in this table is local and
-- authoritative and there is nothing to distinguish by source.
--
-- An import is a clone, not a binding: a projection out of provider-id space into
-- canonical-id space that then diverges freely. origin_plugin_id records where a clone
-- came from purely so the console can badge it, and must not grow into a sync
-- relationship. There is deliberately no dedup on re-import (importing the same upstream
-- playlist twice is meant to yield two independent playlists), no upstream-drift
-- detection, and no unique index on it. Provenance that is actually load-bearing lives
-- on the unresolved placeholders in playlist_tracks, not here.
create table deadair.playlists (
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now() check (updated_at >= created_at),
    id uuid not null default gen_random_uuid() primary key,
    name text not null,
    prompt text not null default '',
    -- Manifest id of the plugin this was cloned from. Null means deadair made it, rather
    -- than a 'deadair' sentinel: this column holds plugin manifest ids, and the console
    -- resolves one to a display name ("Spotify") through PluginRegistry, which no
    -- sentinel could ever resolve through. Null also cannot collide with a real plugin
    -- that claims the id. Soft reference, as everywhere. See artist_sources.plugin_id.
    origin_plugin_id text
);
select deadair.add_updated_at_trigger('deadair.playlists');

-- References the canonical track, never a binding, so a playlist built while Spotify was
-- the only provider still resolves once the same tracks exist locally.
create table deadair.playlist_tracks (
    id uuid not null default gen_random_uuid() primary key,
    playlist_id uuid not null references deadair.playlists (id),
    -- Nullable so an import is not lossy. Importing 200 tracks against a library that
    -- resolves 150 keeps the other 50 as placeholders that can resolve later as the
    -- library grows, instead of failing the import or silently dropping them.
    track_id uuid references deadair.tracks (id),
    -- A placeholder's upstream identity: which plugin's id space, the id itself, and the
    -- CatalogTrack as imported so re-resolution can retry the match without refetching.
    -- Scoped per row rather than per playlist because a playlist can gain unresolved
    -- tracks from a different provider than the one it was originally imported from.
    -- Soft reference, as everywhere. See artist_sources.plugin_id.
    origin_plugin_id text,
    origin_external_id text,
    origin_snapshot jsonb,
    position integer not null,
    -- A row is a resolved track or a fully identified placeholder, never neither and
    -- never a placeholder whose id has no plugin to interpret it.
    constraint playlist_tracks_resolved_check check (
        track_id is not null or (origin_plugin_id is not null and origin_external_id is not null)
    ),
    -- No unique on (playlist_id, track_id): a playlist may legitimately hold the same
    -- track twice (a reprise, a set bookend), and importing one that does must not fail.
    -- Guarding against an accidental double-add is an app concern, not an invariant.
    constraint playlist_tracks_playlist_id_position_key unique (playlist_id, position)
);
create index playlist_tracks_track_idx on deadair.playlist_tracks (track_id) where track_id is not null;
create index playlist_tracks_unresolved_idx on deadair.playlist_tracks (playlist_id) where track_id is null;


-- migrate:down

drop table deadair.playlist_tracks;
drop table deadair.playlists;
drop table deadair.track_analysis;
drop table deadair.track_enrichment;
drop table deadair.album_enrichment;
drop table deadair.artist_enrichment;
drop table deadair.track_sources;
drop table deadair.album_sources;
drop table deadair.artist_sources;
drop table deadair.tracks;
drop table deadair.albums;
drop table deadair.artists;
