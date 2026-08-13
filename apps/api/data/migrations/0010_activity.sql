-- migrate:up

-- The moments the station changed, when nothing else wrote them down.
--
-- The console's activity feed reads three sources and this is the third. `segment_events` (0008)
-- already holds a break's journey and `play_history` (0007) already holds what aired, and neither is
-- copied here: a fact with two writers is two things that can disagree, and the feed unions the
-- three rather than mirroring any of them.
--
-- What is left over is everything that happens to the station as a WHOLE and has no row anywhere:
-- the moment a gate closed on it, the moment an operator stood it down, the moment the running order
-- stopped producing. All of that is live state today — `silence.diagnosis.ts` deliberately stores
-- nothing, because a stored copy of a live gate is a second thing that can disagree with the gate —
-- and living state answers "why is the station quiet" perfectly while answering "why was it quiet at
-- 3am" not at all. This table is the second question and only the second question.
--
-- Append-only, and shaped like `segment_events` and `play_history`: `created_at` and an id, no
-- `updated_at` trigger, no update path. An event is a fact about a moment and is never edited; a
-- correction is another event.
--
-- **Written on EDGES, never on polls.** The console polls the transport twice a second, so a row per
-- reading would make this a log file with a primary key and a retention sweep that could not keep
-- up. `PlayoutService.announceSilence` already only speaks when the cause CHANGES, and that
-- discipline is the whole reason this table can be small enough to keep for months.
create table deadair.station_events (
    created_at timestamptz not null default now(),
    id uuid not null default gen_random_uuid() primary key,
    -- Which part of the station is talking. The console's filter, and the only axis the feed slices
    -- on, because "show me just the playout" is the question an operator actually has. Constrained
    -- rather than free text so the filter cannot silently miss a typo'd producer; nothing has
    -- shipped, so a new value is an edit to this line rather than a migration around it.
    module text not null constraint station_events_module_check check (module in ('playout', 'director', 'render', 'catalog', 'plugins')),
    -- What happened, dotted and stable: `silence.cause`, `air.on`, `air.off`, `starve`, `recover`.
    -- Read by a console deciding how to draw a line, never by anything making a decision.
    kind text not null,
    -- How it reads, not how bad it is. `waiting` is deliberately absent: a station idling for want of
    -- a listener is reported through `detail` as the ordinary state it is, for the same reason
    -- `SilenceState` has a `waiting` that is not a fault. Anything here that says `fault` is
    -- something to go and fix.
    severity text not null default 'info' constraint station_events_severity_check check (severity in ('info', 'warn', 'fault')),
    -- The sentence a person reads. Written at the call site by whatever already had to phrase it —
    -- the silence diagnosis composes one per gate, so the feed carries the diagnosis's own words
    -- rather than a second phrasing of the same fact.
    detail text not null,
    -- The structured half: the `SilenceCause` code, the length of a gap in milliseconds, whatever the
    -- producer wants a later reader to be able to filter or chart on. JSON-safe by the rule in
    -- CLAUDE.md, since it is stored.
    data jsonb,
    -- Who did it, for the operator actions this table will carry. Null for everything the station did
    -- to itself, which is all of it today. `set null` rather than cascade: an operator having stood
    -- the station down at 3am is true whether or not that account still exists.
    actor_id uuid references deadair.actors (id) on delete set null
);

-- The feed's own read: newest first, across everything.
create index station_events_recent_idx on deadair.station_events (created_at desc);

-- The same read with the console's filter applied. Separate rather than relying on the index above,
-- because a station whose playout is quiet for a day would otherwise scan every render event to find
-- the handful the operator asked for.
create index station_events_module_idx on deadair.station_events (module, created_at desc);

-- migrate:down

drop table if exists deadair.station_events;
