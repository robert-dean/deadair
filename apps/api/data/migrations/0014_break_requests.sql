-- migrate:up

-- Somebody asking the station to say something.
--
-- The station's own breaks need no row: `BreakPlanner` walks the running order, sees a gap the
-- spacing rules want filled, and plants one. It is idempotent because the ORDER is the memory —
-- nothing is remembered between passes, so two passes racing produce the same answer.
--
-- A requested break is the opposite kind of thing. It exists because something HAPPENED — a listener
-- tuned in, a bulletin arrived, an operator pressed a button — and none of that is derivable from
-- the running order, so there is nothing for a later pass to re-derive it from. It has to be written
-- down or it is lost the moment the process restarts, and "lost on restart" is the failure the whole
-- feature is about: the moment does not come round again.
--
-- Three things follow from that and each is a column below. A request carries WHY it exists, so the
-- feed and the writer can both use it. It carries a DEDUPE KEY, so a listener whose phone changed
-- networks does not get greeted twice — durably, unlike a map in memory, which would forget across
-- exactly the restart that makes the double-greeting most likely. And it carries an EXPIRY, because
-- a bulletin that took twenty minutes to render is not news and a welcome for a listener who has
-- since left is worse than silence.
create table deadair.break_requests (
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now() check (updated_at >= created_at),
    id uuid not null default gen_random_uuid() primary key,
    -- Whose station asked. Present for the same reason it is on every other station-owned table.
    station_key text not null default 'main',
    -- Which broadcast was on when it was asked, so "what interrupted last night's show" is
    -- answerable. Null for a request made while the station was stood down, which is a state the
    -- director declines rather than stores — so in practice this is set, and nullable because
    -- `StationIdentity` says `undefined` means genuinely no broadcast and a writer must store that
    -- as null rather than reaching for whichever broadcast was last on.
    broadcast_id uuid,
    -- What sort of break to write: the same string as `segments.kind`, and what decides which
    -- writers get asked. Unconstrained text for the reason `segments.kind` is: a station that wants
    -- sponsor spots must not need a migration to have them.
    kind text not null,
    -- How soon it wants to be heard.
    --
    --   interrupt  cut into the music: a talk-over, riding a record rather than sitting between two
    --   next       the next boundary the station reaches
    --   soon       within the next few records
    --   whenever   the next ordinary slot, like any planted break
    --
    -- The first two are RENDERED BEFORE THEY ARE INJECTED and the last two are planted like an
    -- ordinary break. That split is the whole design: a planted break arriving at its slot unready
    -- is skipped, which is right for a routine talk break (another is coming, and silence is worse)
    -- and exactly wrong for one that exists because something happened.
    urgency text not null constraint break_requests_urgency_check check (urgency in ('interrupt', 'next', 'soon', 'whenever')),
    -- Who asked: 'audience', 'operator', later a plugin id. For the log and the activity feed, never
    -- for a decision.
    source text not null,
    -- Why, in the station's own words, for the feed. Never an upstream's text: `ActivityRecorder`'s
    -- rule is that everything in `detail` is written by app code, and a request's reason ends up
    -- there.
    reason text,
    -- What the break is ABOUT, handed to the writer for this kind. A news item's headline, a
    -- caller's name. Null for a request whose kind needs nothing — a welcome is that, and so is
    -- every request until a news writer exists.
    --
    -- Stored, so the JSON-safe rule covers it: no dates as anything but ISO-8601 strings, no
    -- durations as anything but integer milliseconds. Shapeless here on purpose — a writer for a
    -- kind knows what its own kind's context looks like, and nothing generic ever reads it.
    context jsonb,
    -- At most one live request under this key, within the requester's own cooldown. Null for a
    -- request that does not care, which may legitimately double up.
    dedupe_key text,
    -- How far along it is.
    --
    --   pending   accepted; the words and the audio are being made, and it is NOT in the order yet
    --   ready     the audio exists and it is waiting for a slot
    --   placed    it is in the running order
    --   expired   its moment passed before it was ready, so it will not be aired
    --   failed    nothing could write or speak it; `segments.error` says what happened
    --
    -- A `soon` or `whenever` request is born 'placed', because those are planted at once and take
    -- their chances exactly like a planted break. Only the two urgent ones pass through 'pending'
    -- and 'ready'.
    state text not null default 'pending' constraint break_requests_state_check check (state in ('pending', 'ready', 'placed', 'expired', 'failed')),
    -- When this stops being worth airing. Null for the two urgencies that are planted immediately,
    -- whose expiry is the running order itself: they are at a position, and a position cannot go
    -- stale the way a held-back recording can.
    expires_at timestamptz,
    -- The break this became. Set as soon as the row is planned, so a request and its words are one
    -- thing from the first moment. `set null` rather than cascade for `script_history`'s reason: the
    -- request is the record of what was asked for, and it outlives the segment it produced.
    segment_id uuid references deadair.segments (id) on delete set null
);
select deadair.add_updated_at_trigger('deadair.break_requests');

-- The director's drain, on every commit pass: which requests are waiting for a slot. Partial,
-- because the settled states are the overwhelming majority of the table within an hour.
create index break_requests_waiting_idx on deadair.break_requests (station_key, created_at) where state in ('pending', 'ready');

-- The cooldown read: has anything been accepted under this key lately.
create index break_requests_key_idx on deadair.break_requests (station_key, dedupe_key, created_at desc) where dedupe_key is not null;

-- Which request a break was made for.
--
-- The pointer runs this way as well as the other because both reads exist and neither is derivable
-- cheaply from the one column: the director drains requests and needs their segments, and
-- `WriteBreakJob` starts from a segment and needs the context it was asked to write about.
--
-- `set null` rather than cascade, like `segments.persona_id` above it: a break that aired is a break
-- that aired, and losing the request an operator later tidied away must not take the words with it.
alter table deadair.segments add column request_id uuid references deadair.break_requests (id) on delete set null;

-- migrate:down

alter table deadair.segments drop column request_id;

drop table if exists deadair.break_requests;
