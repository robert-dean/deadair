-- migrate:up

-- The station's own programming, as opposed to the running order.
--
--   lineups        what the station INTENDS to air, as ordered lists. Many named rows,
--                  because a daypart schedule names a different one per part of the day
--                  and the whole point is that they coexist.
--
--                  SUPERSEDED by station_lineup below, and being emptied out rather than
--                  extended. Everything this comment says about several lineups coexisting
--                  is the library half of a job it turned out could not do both halves of;
--                  see `docs/decisions/on-air-ownership.md`.
--   station_lineup the ONE live running order per station: what is airing, item by item,
--                  each item carrying its own state.
--   station_air    what is on air right now, per output. Which lineup, and how far
--                  through it the broadcast has got.
--   play_history   what actually AIRED, which is the only thing the rotation rules may be
--                  steered by. Written when the player confirms a track started, never
--                  when one is handed over.
--
-- "Lineup" rather than "playlist" because `deadair.playlists` is a different thing: a saved
-- library of tracks deadair owns, which a lineup may be built FROM. And rather than
-- "rundown", which is taken by the short window the player is actually holding — the
-- lineup is the deep plan behind it, and only a few items of it are committed at a time.
--
-- A lineup is not one kind of thing. The station's ordinary rotation, a Christmas setlist
-- and an album played in full are three different sorts of programming with three different
-- sets of rules, and `mode` is what tells them apart.
--
-- The running order itself stays in memory and is deliberately not here: it is what the
-- player is holding, it is rebuilt from these rows in seconds, and persisting it would give
-- the station two disagreeing opinions about what is next.

create table deadair.lineups (
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now() check (updated_at >= created_at),
    id uuid not null default gen_random_uuid() primary key,
    name text not null,
    -- Who built it: an operator importing a provider playlist, or the director choosing
    -- tracks. Text rather than an enum for the reason `track_sources.plugin_id` is: a new
    -- builder must not need a migration.
    source text not null default 'import',
    -- Where an imported one came from, so the console can say "Discover Weekly, from
    -- Spotify" and a refresh knows what to re-read. Null for anything the director built.
    source_plugin_id text,
    source_playlist_id text,
    -- What this lineup IS. Three different kinds of programming, not three flags.
    --
    --   rotation  the station's ordinary programming. The director keeps topping it up
    --             with new tracks, and the rotation rules (repeat window, artist cooldown,
    --             per-artist cap) apply.
    --   setlist   a finite, curated list, played through and started again. Nothing is
    --             generated and no rotation rule applies — a Christmas setlist is played
    --             across a month precisely because it repeats, and a repeat window would
    --             suppress the very tracks it exists to play.
    --   feature   a record played in full, in its own order, once: an album, a live set, a
    --             themed hour. Never shuffled, never extended, and the segues are the
    --             point, so nothing talks over them. The operator's own words for it are
    --             "play this album", and everything the station otherwise does to a list
    --             would be wrong here.
    --
    -- A column rather than a special case in the reactor. What it does NOT decide is what
    -- happens when the list runs out; see `on_end`.
    mode text not null default 'rotation' constraint lineups_mode_check check (mode in ('rotation', 'setlist', 'feature')),
    -- What the station does when it reaches the end of this lineup.
    --
    --   extend    generate more and carry on. A rotation's default, and meaningless for
    --             anything the director did not build.
    --   repeat    start again from the top. A setlist's default.
    --   resume    hand the station back to whatever this interrupted, at the point it had
    --             reached. A feature's default, and the reason `station_air` remembers a
    --             lineup and cursor to return to.
    --   rotation  put the slot's home programming on air (`station_air.default_lineup_id`).
    --             Falls through to `stop` when the operator has not named one, rather than
    --             guessing at a lineup nobody chose.
    --   stop      stand down. The station goes quiet, exactly as it does when a rotation
    --             drains, which is a legitimate thing to want at the end of a broadcast.
    --
    -- Separate from `mode` because all of these are valid for a feature, and which one an
    -- operator wants is a decision about their station rather than about the record.
    on_end text not null default 'extend' constraint lineups_on_end_check check (on_end in ('extend', 'repeat', 'resume', 'rotation', 'stop')),
    -- The ordered list: an array of items, each a track or a segment. JSON rather than a
    -- child table because the ORDER is the data and nothing joins to an individual line; a
    -- row-per-item schema buys referential integrity for something that is rewritten
    -- wholesale on every reorder.
    items jsonb not null default '[]'::jsonb,
    -- Bumped on every change to the order, so a console edit made against a stale view is
    -- refused rather than applied to a list that has moved underneath it.
    revision integer not null default 0,
    -- Per-lineup overrides of the station's defaults, field by field. Null means "use the
    -- defaults", and the defaults themselves follow from `mode` — a setlist turns the
    -- rotation rules off, a feature turns shuffling and talking over the segues off too.
    -- Every one of them can be overridden here, which is what keeps those modes ordinary
    -- rather than special.
    rules jsonb
);
select deadair.add_updated_at_trigger('deadair.lineups');

-- The live on-air running order: one row per station, and the only thing that airs.
--
-- Not a library, and that is the whole difference between it and `lineups` above. A lineup
-- was asked to be both a reusable named list and the broadcast in progress, and every
-- mechanism that had to reconcile the two (the cursor, the revision, compaction) was a
-- source of bugs rather than a feature. See `docs/decisions/on-air-ownership.md`.
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
    -- What this broadcast IS, and what happens when it runs out. Same vocabulary as `lineups`
    -- minus the arms that only meant anything to a library: `resume` and `rotation` both named
    -- another stored lineup to hand the station back to, and there is no longer one to name.
    mode text not null default 'rotation' constraint station_lineup_mode_check check (mode in ('rotation', 'setlist', 'feature')),
    on_end text not null default 'extend' constraint station_lineup_on_end_check check (on_end in ('extend', 'repeat', 'stop')),
    -- Per-broadcast overrides of the station's defaults, field by field. Null uses the
    -- defaults, which follow from `mode`.
    rules jsonb
);
select deadair.add_updated_at_trigger('deadair.station_lineup');

-- What is on air, one row per output.
--
-- Keyed by slot rather than being a single-row table: a second mount, or a pre-roll deck,
-- should be a row and not a migration. Today there is exactly one, 'main'.
--
-- The cursor lives HERE and not on the lineup, because it describes this broadcast rather
-- than the plan. The same lineup put on air again tomorrow starts from the top, and a
-- lineup that is merely being edited has no cursor at all.
--
-- `active` is the station's own switch, and it is why a stood-down station stays down
-- across a restart instead of putting itself back on air with whatever it was holding.
create table deadair.station_air (
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now() check (updated_at >= created_at),
    slot text primary key default 'main',
    -- Set null rather than restrict: the service refuses to delete a lineup that is on air,
    -- and this is the backstop for the case it somehow misses rather than a second opinion
    -- about the rule.
    lineup_id uuid references deadair.lineups (id) on delete set null,
    "cursor" integer not null default 0 constraint station_air_cursor_check check ("cursor" >= 0),
    active boolean not null default false,
    -- What to go back to, and where in it, once the current lineup ends with `on_end =
    -- 'resume'`. Written when something INTERRUPTS: an album feature put on air over the
    -- afternoon rotation, and later a breaking-news insert or a request block.
    --
    -- The cursor is remembered with it because resuming a rotation from the top would
    -- replay the last hour of the show it interrupted. Both null when nothing was
    -- interrupted, which is the ordinary state and means `resume` degrades to standing down.
    resume_lineup_id uuid references deadair.lineups (id) on delete set null,
    resume_cursor integer constraint station_air_resume_cursor_check check (resume_cursor is null or resume_cursor >= 0),
    -- The slot's home programming: what `on_end = 'rotation'` puts on air. Null means the
    -- operator has not named one, and that case stands the station down rather than picking
    -- a lineup nobody chose.
    default_lineup_id uuid references deadair.lineups (id) on delete set null
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
drop table if exists deadair.lineups;
