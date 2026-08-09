-- migrate:up

-- Segments: the things the station plays that are not records.
--
-- A talk break, a station ident, a stinger, a news bulletin, and later a whole show episode. One
-- row is ONE AIRABLE ELEMENT, however it was made: an episode written across a dozen beats in
-- as many voices is still one thing the running order names and one file the player fetches.
-- Whatever went into producing it is the render module's own business and belongs in its own
-- tables, not here.
--
-- "Segment" rather than a new word because the vocabulary is already committed: 0007's `items`
-- comment says a lineup holds "a track or a segment", and docs/todo/director-and-lineups.md
-- specifies the lineup arm as `kind: 'segment'`.
--
-- Deliberately no lineup_id. A segment is a thing the station CAN say; which running order it
-- sits in, and how often, is the lineup's business, and an ident that plays six times a day
-- would otherwise need six rows. The reference points the other way: `lineups.items` names a
-- segment by id.
create table deadair.segments (
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now() check (updated_at >= created_at),
    id uuid not null default gen_random_uuid() primary key,
    -- What sort of element this is: 'ident', 'stinger', 'talkbreak', 'news'. Text rather than an
    -- enum for the reason `track_sources.plugin_id` and `lineups.source` are: a station that
    -- wants sponsor spots must not need a migration to have them.
    kind text not null default 'ident',
    -- How far along producing it is.
    --
    --   planned    the station means to say this; there is no audio yet
    --   rendering  something is producing it right now
    --   ready      there is audio, and it can be committed to a running order
    --   failed     producing it did not work, and `error` says what happened
    --
    -- Every row the library scan writes is born 'ready', because the audio is what it was made
    -- from. The column still earns its place now: it is what the director reads to decide whether
    -- a segment can air, and a segment that is not ready is SKIPPED rather than waited for, so
    -- the station never falls silent holding a slot open for a renderer. That rule is the seam
    -- the TTS work drops into later, and it is cheaper to honour from the start than to retrofit
    -- into the director once something depends on the old behaviour.
    state text not null default 'planned' constraint segments_state_check check (state in ('planned', 'rendering', 'ready', 'failed')),
    -- What the console calls it, and what the mount is labelled with while it airs. Not the
    -- script: a listener's player should read "Station ident" rather than a paragraph of speech.
    label text not null,
    -- The words, for anything that speaks. Null for an imported file, whose words are whatever
    -- somebody recorded.
    script text,
    -- Who made it: 'library' for a file dropped into the inbox, later 'render' for one this
    -- station spoke itself. Unconstrained text, like `lineups.source`.
    source text not null default 'library',
    -- The file in the inbox this was imported from, kept so the console can say where a segment
    -- came from and a re-scan can report a file it already knows. Not a path the server ever
    -- reads back: the bytes were copied into the content-addressed store on import, so deleting
    -- the inbox file does not take the segment off the air.
    source_path text,
    -- sha256 of the audio, hex, and its extension on disk: together they are the file under
    -- SEGMENT_DIR. Both null until there is audio, and set together or not at all.
    audio_checksum text,
    audio_ext text,
    -- How long it runs. A display value only. Nothing schedules against it: Liquidsoap measures
    -- the request itself, which is the only reading that cannot be thrown off by a bad tag.
    duration_ms integer constraint segments_duration_check check (duration_ms is null or duration_ms >= 0),
    -- Why `state` is 'failed'. Cleared when a later attempt works, so the table never reads as
    -- broken for a fault that has since been fixed.
    error text,
    -- Which voice the station wanted this said in.
    --
    -- A name the STATION chose ('host', 'newsreader'), not one any engine knows. The speech plugin
    -- maps it to whatever it actually takes — a named preset on one engine, a cloned reference clip on
    -- the next — so swapping the engine does not rewrite every segment that ever named a voice. That
    -- indirection is the one part of v1's voice handling worth keeping; what is left behind is where
    -- the mapping lived, which was a per-provider matrix in the app.
    --
    -- Null means "whatever the plugin's default is", which is the ordinary case: a station with one
    -- voice never sets this, and neither does an imported recording, whose voice is whoever spoke into
    -- the microphone. Unconstrained text, like `kind` and `source` beside it: a station that invents a
    -- fourth persona must not need a migration to have one.
    voice text,
    -- What decided the words: 'deterministic' for the station's own templates, later the id of the
    -- plugin whose model wrote them. Null for an imported file, whose words are whoever recorded them,
    -- and null for a segment planned before anything has written it.
    --
    -- Kept because "the model wrote this one and the stub wrote that one" is the question an operator
    -- asks first when a station starts sounding flat, and it cannot be answered afterwards from a log
    -- line that has scrolled away. Unconstrained text for the same reason as `source`.
    writer text
);
select deadair.add_updated_at_trigger('deadair.segments');

-- One dropped file is one segment, however many times the inbox is scanned. Content-addressed, so
-- the same recording arriving twice under two names is recognised as the one it already has.
--
-- Scoped to the library, deliberately. A station that says the same words twice on two different
-- days said them twice, and two rendered segments that happen to produce identical audio are still
-- two things the station said; only an IMPORT is a re-import.
create unique index segments_library_checksum_idx on deadair.segments (audio_checksum) where source = 'library' and audio_checksum is not null;

-- The planner's read: "give me an ident that can go on air". Partial, because a segment that is
-- not ready is never a candidate.
create index segments_ready_idx on deadair.segments (kind, created_at) where state = 'ready';

-- What happened to a segment, and when, as rows rather than as log lines.
--
-- `segments.state` says where a segment IS. This says how it got there: planned at one moment,
-- claimed at another, ready or failed at a third. The difference matters because the interesting
-- questions are all about the journey — how long a render took, whether a break was written by the
-- model or fell back to the templates, why last night's talk break never aired — and a column
-- holding the current state can answer none of them once it has moved on.
--
-- A table rather than four timestamp columns on `segments`, because the console's activity feed
-- reads transitions across ALL segments in time order, and columns would have to be unpivoted to
-- answer that. This way the feed is a transport over rows that already exist, which is the whole
-- reason for writing them down now rather than after something wants them: doing it later is a
-- migration plus a backfill nobody can perform, since the history it would need is gone.
--
-- Append-only, and shaped like `play_history`: `created_at` and an id, no `updated_at` trigger. An
-- event is a fact about a moment and is never edited.
create table deadair.segment_events (
    created_at timestamptz not null default now(),
    id uuid not null default gen_random_uuid() primary key,
    -- Cascade, unlike `play_history.track_id`. That one is set null because a record having aired
    -- is true whether or not the catalog still knows the track; this is different, because an event
    -- describes a segment's own life and means nothing once the segment is gone.
    segment_id uuid not null references deadair.segments (id) on delete cascade,
    -- Where it came from. Null for the first event of a row, which came from nowhere.
    from_state text constraint segment_events_from_check check (from_state is null or from_state in ('planned', 'rendering', 'ready', 'failed')),
    to_state text not null constraint segment_events_to_check check (to_state in ('planned', 'rendering', 'ready', 'failed')),
    -- Why, in a sentence, when there is one worth keeping: the error that failed a render, or the
    -- note that a break degraded to the deterministic writer because the model declined. Null for
    -- an ordinary transition that speaks for itself.
    reason text
);

-- The two reads: one segment's story, and the station's most recent activity across all of them.
create index segment_events_segment_idx on deadair.segment_events (segment_id, created_at);
create index segment_events_recent_idx on deadair.segment_events (created_at desc);

-- migrate:down

-- Dropped explicitly and first, rather than left to the cascade, so the down migration says what it
-- removes instead of relying on a foreign key to imply it.
drop table if exists deadair.segment_events;
drop table if exists deadair.segments;
