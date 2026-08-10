-- migrate:up

-- The station's own programming, as opposed to the running order.
--
--   station_lineup the ONE live running order per station: what is airing, item by item,
--                  each item carrying its own state.
--   station_air    whether the station is driving, per output.
--   play_history   what actually AIRED, which is the only thing the rotation rules may be
--                  steered by. Written when the player confirms a track started, never
--                  when one is handed over.
--
-- "Lineup" rather than "playlist" because `deadair.playlists` is a different thing: prepared
-- source material a running order is built FROM. The rule that keeps the two honest is that
-- if it is airing it is a lineup, and if it is prepared it is a playlist. Nothing is both,
-- which is the entire content of `docs/decisions/on-air-ownership.md`.

-- The live on-air running order: one row per station, and the only thing that airs.
--
-- Not a library. There was a `lineups` table here that tried to be both a reusable named
-- list and the broadcast in progress, and every mechanism that had to reconcile the two —
-- the cursor, the revision, compaction — was a source of bugs rather than a feature. See
-- `docs/decisions/on-air-ownership.md`.
--
-- So there is exactly one of these per station, it is built when the station goes ON AIR,
-- and it is consumed. Prepared material is a playlist: a provider's, or `deadair.playlists`.
-- The rule that keeps the two honest is that if it is airing it is a lineup, and if it is
-- prepared it is a playlist.
--
-- Keyed by station rather than being a single-row table, from the first migration that
-- creates it rather than once rows exist: one director per station is the answer
-- multi-station wants, and a key added later is a migration over live broadcast state.
-- Today there is exactly one, 'main', matching `station_air.slot`.
create table deadair.station_lineup (
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now() check (updated_at >= created_at),
    station_key text primary key default 'main',
    -- What the operator is told is on: "Discover Weekly, from Spotify". A label for this
    -- broadcast rather than the identity of a stored object, which is why nothing looks a
    -- row up by it.
    name text not null default '',
    -- The ordered list: every item, breaks among them, each carrying its own state.
    --
    --   planned  committed to nothing yet. The only state an operator may edit.
    --   handed   given to the player, not yet confirmed on air. A promise, not a fact.
    --   airing   the player says this is what a listener is hearing.
    --   played   heard, and behind us.
    --   skipped  passed over: a segment with no audio, or an item the player never started.
    --
    -- One document rather than a row per item, deliberately. A live running order is bounded
    -- at tens of items, the order IS the data, nothing joins to an individual line, and the
    -- writes are coalesced on a throttle whatever the shape. Rows only win if something needs
    -- to query across items, and nothing does.
    items jsonb not null default '[]'::jsonb,
    -- Where more material comes from, which is a BINDING and not an identity. A lineup starts
    -- from a playlist, gets topped up by the generator, gets requests inserted and breaks
    -- planted, so material from several sources sits in one lineup at once and the binding can
    -- change mid-life.
    source text not null default 'director',
    source_plugin_id text,
    source_playlist_id text,
    -- What this broadcast IS, and what happens when it runs out. `on_end` had two more arms
    -- while there was a library: `resume` and `rotation` each named another STORED lineup to
    -- hand the station back to, and there is no longer one to name. `repeat` survives because
    -- under one live order it is every played item offered again, which is a real thing to
    -- want of a setlist rather than a library workflow.
    mode text not null default 'rotation' constraint station_lineup_mode_check check (mode in ('rotation', 'setlist', 'feature')),
    on_end text not null default 'extend' constraint station_lineup_on_end_check check (on_end in ('extend', 'repeat', 'stop')),
    -- Per-broadcast overrides of the station's defaults, field by field. Null uses the
    -- defaults, which follow from `mode`.
    rules jsonb
);
select deadair.add_updated_at_trigger('deadair.station_lineup');

-- Whether the station is driving, one row per output.
--
-- Keyed by slot rather than being a single-row table: a second mount, or a pre-roll deck,
-- should be a row and not a migration. Today there is exactly one, 'main', and it matches
-- `station_lineup.station_key`.
--
-- One column of substance, and that is the point of it. This row used to name the lineup on
-- air and hold the position the broadcast had reached, which made it a second opinion about
-- programming that lives next door in `station_lineup` — and the older opinion always won.
-- What the station is airing is the running order itself; all this says is whether the
-- station is putting it out.
--
-- `active` is the station's own switch, and it is why a stood-down station stays down across
-- a restart instead of putting itself back on air with whatever it was holding.
create table deadair.station_air (
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now() check (updated_at >= created_at),
    slot text primary key default 'main',
    active boolean not null default false
);
select deadair.add_updated_at_trigger('deadair.station_air');

-- What the station has aired.
--
-- Its own table rather than a kind of event log, because it is read on the hot path of every
-- refill: "which songs are still inside the repeat window" and "which artists are still
-- cooling down" are two indexed lookups here and two scans of anything general.
--
-- The keys are the normalized spellings (`normalizeKey`), written here so the reader and the
-- writer can never disagree about what "the same song" means. The display columns are kept
-- alongside them because history outlives the catalog row it came from: a track whose
-- binding is later dropped still aired, and the log must still be able to say what it was.
create table deadair.play_history (
    created_at timestamptz not null default now(),
    id uuid not null default gen_random_uuid() primary key,
    -- The canonical track, when the catalog holds one. Null for anything aired straight from
    -- a provider, and set null rather than cascade on delete: the fact that it aired is not
    -- undone by the catalog forgetting the row.
    track_id uuid references deadair.tracks (id) on delete set null,
    -- The copy that actually played. Soft reference, like every other plugin_id in the schema.
    plugin_id text not null,
    external_id text not null,
    title text not null,
    artists text not null,
    song_key text not null,
    artist_key text not null,
    -- What put it in the running order: an import, the director, later a listener request or
    -- a plugin. Unconstrained text on purpose; a new one must not need a migration.
    source text not null default 'director',
    aired_at timestamptz not null default now()
);

-- The three reads: the log itself, the repeat window, the artist cooldown. The two keyed
-- indexes carry `aired_at` so the window predicate is answered from the index alone.
create index play_history_aired_at_idx on deadair.play_history (aired_at desc);
create index play_history_song_idx on deadair.play_history (song_key, aired_at desc);
create index play_history_artist_idx on deadair.play_history (artist_key, aired_at desc);

-- migrate:down

drop table if exists deadair.play_history;
drop table if exists deadair.station_air;
drop table if exists deadair.station_lineup;
