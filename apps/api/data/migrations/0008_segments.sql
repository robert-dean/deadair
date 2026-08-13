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
    --   planned    the station means to say this; nothing has been written and there is no audio
    --   writing    a writer has claimed it and is deciding what it says
    --   written    the words are committed; the audio is what is missing
    --   rendering  something is producing it right now
    --   ready      there is audio, and it can be committed to a running order
    --   failed     producing it did not work, and `error` says what happened
    --
    -- Every row the library scan writes is born 'ready', because the audio is what it was made
    -- from. The column still earns its place now: it is what the director reads to decide whether
    -- a segment can air, and a segment that is not ready is SKIPPED rather than waited for, so
    -- the station never falls silent holding a slot open for a renderer.
    --
    -- Making a break is TWO pieces of work with different failure modes — deciding what it says,
    -- then producing the audio — and each is its own job. There is a state per stage so the column
    -- says which one a row is in and, more usefully, which one it came out of: a retry after a
    -- failed render starts from 'written' and re-renders the words that already exist, rather than
    -- from 'planned', which would pay a model to invent different words for a break that was
    -- already correct. Two states rather than one for the same reason: 'writing' is work in flight
    -- and 'written' is work finished, and a claim that could not tell them apart could not stop a
    -- second writer starting on a break the first one was halfway through.
    state text not null default 'planned' constraint segments_state_check check (state in ('planned', 'writing', 'written', 'rendering', 'ready', 'failed')),
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
    writer text,
    -- Which running-order line this break's words CLAIM will play next.
    --
    -- A break that says "coming up, X" is making a statement about the future: written when the
    -- break is planned, spoken minutes later out of audio rendered in between. Everything that can
    -- happen to a running order in that gap makes it false — an operator moves the item, a request
    -- is inserted, the resolver drops the pick, the item is skipped for having no ready audio — and
    -- the station then names a record that is not the one playing, confidently. That sounds worse
    -- than saying nothing and is the kind of error a listener remembers.
    --
    -- The claim cannot be re-resolved nearer to air, because it is baked into WORDS and rendered
    -- audio cannot be re-cut. So it is written down here instead, and checked at hand-over against
    -- what is actually next. Null for a break that promised nothing, which is most of them.
    --
    -- A lineup ITEM id rather than a track id: the same record can sit in an order twice, and what
    -- the words named is the one at that position. Not a foreign key, because the running order is
    -- one jsonb document rather than rows — the check is a comparison in the director, and a stale
    -- id simply fails it, which is the safe direction.
    claims_item_id text,
    -- When this break is expected to AIR, when a rule on the station clock placed it.
    --
    -- Written by the planner and read by the writer, which is the whole of why it is a column
    -- rather than a job argument. The words are asked for on a later pass than the one that planted
    -- the break — `ripen` re-offers whatever is still planned on every boundary, and it does not
    -- recompute the schedule — so the target has to travel on the row or the writer has nothing to
    -- say the time from. Null for a break planted by ordinary spacing, which is not about a time
    -- and has none to name.
    --
    -- The PROJECTION rather than the time the operator asked for. The running order is made of
    -- whole records, so a band at half past lands on the first gap at or after it and may be a
    -- couple of minutes late. What the break says has to describe when it will be SPOKEN, or a
    -- break placed for half past and aired at twenty-five to announces a moment that has gone.
    -- That the projection may itself be a minute out is what claims_time_* below covers.
    airs_at timestamptz,
    -- The window this break's words stay true in.
    --
    -- The sibling of `claims_item_id`, and the same argument in a different dimension: that column
    -- exists because a break naming the next RECORD can be overtaken by an edit, and these exist
    -- because a break naming the TIME can be overtaken by the clock. Both are statements baked into
    -- audio that cannot be re-cut, and both are therefore written down and checked at hand-over
    -- rather than re-resolved.
    --
    -- Two columns rather than a range because the two ends are read separately and a range would
    -- need its own operator class on a column nothing will ever index. Both null together: a break
    -- that named no time makes no claim about when it airs, which is most of them.
    --
    -- The bounds come from the PHRASING, not from a constant. "Just after nine" is good for a few
    -- minutes and "coming up to half past" stops being true at half past, so how long a wording
    -- lasts is a fact about that wording — see `clock.words.ts`, which answers with the words and
    -- their window together so the two cannot disagree.
    claims_time_from timestamptz,
    claims_time_until timestamptz,
    constraint segments_claims_time_check check (
        (claims_time_from is null) = (claims_time_until is null)
        and (claims_time_until is null or claims_time_until > claims_time_from)
    )
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
    from_state text constraint segment_events_from_check check (
        from_state is null or from_state in ('planned', 'writing', 'written', 'rendering', 'ready', 'failed')
    ),
    to_state text not null constraint segment_events_to_check check (to_state in ('planned', 'writing', 'written', 'rendering', 'ready', 'failed')),
    -- Why, in a sentence, when there is one worth keeping: the error that failed a render, or the
    -- note that a break degraded to the deterministic writer because the model declined. Null for
    -- an ordinary transition that speaks for itself.
    reason text
);

-- The two reads: one segment's story, and the station's most recent activity across all of them.
create index segment_events_segment_idx on deadair.segment_events (segment_id, created_at);
create index segment_events_recent_idx on deadair.segment_events (created_at desc);

-- Everything the station ever wrote, including the attempts that came to nothing.
--
-- `segments.script` holds the CURRENT words of a segment that still exists, and that is all it can
-- do: a rewritten row loses what it said before, a writer that declined leaves only a reason on a
-- row that has since moved on, and a deleted segment takes its words with it. None of that can be
-- reconstructed afterwards, and all of it is what somebody wants the first time a break sounds
-- wrong. It is also the raw material for anything transcript-shaped later.
--
-- One row per write ATTEMPT rather than per segment. A break where the model declined and the floor
-- covered for it is TWO rows, and that is the point: the second on its own reads as a station that
-- never had a model configured, which is the wrong thing for an operator to conclude.
--
-- Append-only, and shaped like `segment_events` and `play_history` above it: `created_at`, an id,
-- and deliberately NO `updated_at` and no trigger. A row is a fact about a moment and is never
-- edited, so a column saying when it last changed could only ever repeat `created_at` — and having
-- one invites somebody to make it lie. A correction is another attempt, which is another row.
create table deadair.script_history (
    created_at timestamptz not null default now(),
    id uuid not null default gen_random_uuid() primary key,
    -- Set null rather than cascade, unlike `segment_events.segment_id`. That table describes a
    -- segment's own life and means nothing once the segment is gone; this one exists PRECISELY to
    -- outlive it, which is why everything below is denormalised enough to stand on its own.
    segment_id uuid references deadair.segments (id) on delete set null,
    kind text not null,
    -- Both null for an attempt that produced nothing. The label is kept beside the script for the
    -- same reason they are written together: it names the break these particular words are for.
    label text,
    script text,
    -- Which binding produced or declined this. `BreakWriter.name`: 'deterministic' today, a model
    -- and an operator's templates later. Unconstrained text, like `segments.writer`.
    writer text not null,
    -- Which model said it, for a writer that used one. Null otherwise, which is most rows.
    model text,
    -- What the line was rendered FROM, for a writer that works from something an operator can edit:
    -- the template, once there are templates. Null for a model, whose input is `prompt` below.
    -- Without it, tuning a set of phrasings is guesswork about which one produced which line.
    source text,
    -- The two records this was written against, as the writer saw them. A script that names the
    -- wrong record is only diagnosable next to what it was actually told.
    previous jsonb,
    next jsonb,
    -- Whether there are words: 'written', 'declined' (the writer had nothing to say), or 'failed'
    -- (it threw). The last two are different problems wearing the same silence.
    outcome text not null constraint script_history_outcome_check check (outcome in ('written', 'declined', 'failed')),
    -- Why, for anything that is not 'written'.
    reason text,
    -- What it cost: the provider's own token counts, and how long the attempt took. Kept for every
    -- attempt rather than only a slow one, because "the model got slower" is a question that can
    -- only be asked of numbers gathered before anybody suspected it.
    usage jsonb,
    duration_ms integer constraint script_history_duration_check check (duration_ms is null or duration_ms >= 0),
    -- The two expensive ones, filled only while `llm.captureWrites` is on. They are most of the
    -- volume of this table and they are exactly what an evening of prompt tuning needs, so they are
    -- a switch an operator turns on and off rather than a default.
    prompt jsonb,
    raw text
);

-- The two reads: the station's recent writing, and one segment's. The first is also what the
-- retention sweep deletes by, which is why `created_at` leads it.
create index script_history_recent_idx on deadair.script_history (created_at desc);
create index script_history_segment_idx on deadair.script_history (segment_id, created_at) where segment_id is not null;

-- migrate:down

-- Dropped explicitly and first, rather than left to the cascade, so the down migration says what it
-- removes instead of relying on a foreign key to imply it.
drop table if exists deadair.script_history;
drop table if exists deadair.segment_events;
drop table if exists deadair.segments;
