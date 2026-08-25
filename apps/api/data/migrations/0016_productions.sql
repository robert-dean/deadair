-- migrate:up

-- Something the station MAKES, as against something it says.
--
-- A break is one script, one file, one slot, and every part of it is disposable: a segment that is
-- not ready when its moment comes is skipped, because another break is along shortly and silence is
-- worse than a missed sentence. That trade is what the whole render path is built on.
--
-- A production is the other kind of thing. It is several beats of speech written in several passes,
-- it airs as one block, and no part of it is disposable — beat 4 missing is not a shorter programme,
-- it is a programme with a hole in the middle. A podcast episode is one of these. A long-form news
-- bulletin with four stories is another. A twenty-second headline read is NOT one, and stays a
-- break: the line is whether the thing has an internal shape that a missing piece would break.
--
-- ## The row IS the state machine, and that is what makes a restart survivable
--
-- Making one of these takes minutes to hours and several separate model calls. One job for all of it
-- would need an `expiresIn` so large that a wedged run could not be reclaimed for hours, and a
-- restart in the middle would have nothing to resume from. So there is one job per PASS, and this
-- row is what says which pass finished — the checkpoint is the thing being checkpointed rather than
-- a table beside it.
--
-- The same argument is why `cancelled_at` is here and is TERMINAL. A queue cannot cancel: a message
-- already sent will be delivered, and a broker will happily resurrect a run minutes after somebody
-- stopped it. So cancellation is a fact on the row that every pass checks before it spends anything,
-- which is the same shape the director's epoch has for the same reason.
--
-- ## What is deliberately NOT here
--
-- No audio, no script and no position. A beat is a `deadair.segments` row (see the two columns added
-- at the bottom), which means it inherits the whole existing machinery — the per-stage state, the
-- conditional claim, `segment_events`, `script_history`, `RenderSegmentJob` and the content store —
-- rather than growing a second copy of all of it. And a production reaches the running order the way
-- an urgent break already does: nothing is placed until every beat is `ready`, and then the block
-- goes in whole.
create table deadair.productions (
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now() check (updated_at >= created_at),
    id uuid not null default gen_random_uuid() primary key,
    -- Whose production this is, on every station-owned table since the first migration.
    station_key text not null default 'main',
    -- Which broadcast this was made FOR, when it was made for one.
    --
    -- Nullable and meaning it: a production commissioned while the station is off air, or scheduled
    -- for tomorrow, genuinely belongs to no broadcast, and `StationIdentity`'s rule is that such a
    -- writer stores null rather than reaching for whichever broadcast was last on. It is not which
    -- broadcast AIRED it — that is answered by the `segment_events` its beats write when they do.
    broadcast_id uuid,
    -- What sort of production: 'podcast', 'bulletin', 'feature'. Unconstrained text for the reason
    -- `segments.kind` and `track_sources.plugin_id` are: a station that wants a documentary strand
    -- must not need a migration to have one.
    kind text not null default 'podcast',
    -- What it is called, for the console and for the beats' own labels.
    title text not null,
    -- What the operator asked for, in their own words ("the history of the Roland TR-808").
    --
    -- Distinct from `title`, which is only a label, exactly as `station_lineup.brief` is distinct
    -- from its `name`. This is the thing the outline pass is actually working from.
    brief text,
    -- Who presents it. Null falls back to the station's active persona at the moment a pass runs,
    -- through `PersonaRepository.presenting`, which is the one place that precedence lives.
    persona_id uuid references deadair.personas (id) on delete set null,
    -- Who speaks, one entry per member: the presenter, and whoever was cast to phone in.
    --
    -- This was `voices`, a list of station voice ids and nothing else, held open for the cast it was
    -- always going to become. It is that now — each member carries the persona it is, the name it
    -- goes by on air and the voice that says it — and it is written once, by the first pass, rather
    -- than resolved per beat: the roster can change under a production that takes hours to make, and
    -- a programme whose caller changed identity half way through is not a programme.
    --
    -- Not named `cast`: that is a reserved word in SQL and would need quoting at every use.
    casting jsonb,
    -- How many passes the operator wants spent on it, defaulted from `render.productionWritingMode`.
    --
    -- Constrained here rather than left open, unlike `kind`: a mode names a pass CHAIN that
    -- `production.passes.ts` has to know how to run, so an unknown one is a production nothing can
    -- make rather than a station preference nobody implemented.
    writing_mode text not null default 'outlined' constraint productions_mode_check check (writing_mode in ('quick', 'outlined', 'polished')),
    -- How long it should run, in milliseconds. What the beat count and the per-beat word budgets are
    -- computed FROM: timing never comes from the model, which was learned the expensive way when one
    -- story in a ten-minute show meant a single beat asked to carry about 1300 spoken words.
    target_ms integer not null constraint productions_target_check check (target_ms > 0),
    -- The computed shape: how many beats and how many words each. Arithmetic, never the model's.
    plan jsonb,
    -- What the outline pass decided: a throughline, running threads, and one entry per beat carrying
    -- its angle, who leads it, what it plants for later and what earlier plant it lands.
    --
    -- This is where FORESIGHT lives, and it is the reason a beat is never shown the future. A beat is
    -- told what it owes and what it must pay off; it does not need to read the beats after it, which
    -- would cost context on every pass and drift as soon as one of them was rewritten.
    outline jsonb,
    -- How far along making it is.
    --
    --   planned    commissioned; no pass has run
    --   outlining  deciding the shape
    --   drafting   writing the beats
    --   checking   judging them and re-drafting at most once
    --   rendering  the beats are being spoken
    --   ready      every beat has audio and the block can be placed
    --   aired      it went out
    --   failed     making it did not work, and `error` says what happened
    --   cancelled  somebody stopped it, and no pass may spend anything else on it
    state text not null default 'planned' constraint productions_state_check check (
        state in ('planned', 'outlining', 'drafting', 'checking', 'rendering', 'ready', 'aired', 'failed', 'cancelled')
    ),
    error text,
    -- When it should air, for one the format clock asked for.
    --
    -- Null for a production commissioned on demand, which is an ordinary state rather than a missing
    -- value: it means "as soon as it is made". It is also what the gate's priority is computed from —
    -- a production due in twenty minutes outranks one due tomorrow — so a null one stays background
    -- work throughout, which is correct for something nobody is waiting on.
    scheduled_for timestamptz,
    -- When it was stopped, and the only terminal fact a pass is required to re-read.
    --
    -- Separate from `state = 'cancelled'` rather than derived from it, because the two answer
    -- different questions: the state says what the row IS, and this says when somebody decided, which
    -- is what a console shows and what distinguishes a cancelled run from one that failed.
    cancelled_at timestamptz,
    -- Who asked for it. Null for one the format clock commissioned, which nobody asked for.
    actor_id uuid references deadair.actors (id) on delete set null
);
select deadair.add_updated_at_trigger('deadair.productions');

-- The scheduler's drain: what is still being made, oldest first. Partial, because the settled states
-- are the whole table within a day and none of them is ever a candidate for another pass.
create index productions_pending_idx on deadair.productions (station_key, created_at)
    where state not in ('aired', 'failed', 'cancelled');

-- What is due next, for the clock-driven half and for the priority a pass runs at.
create index productions_scheduled_idx on deadair.productions (station_key, scheduled_for)
    where scheduled_for is not null and state not in ('aired', 'failed', 'cancelled');

-- A beat, and which beat it is.
--
-- The columns go HERE rather than in 0008 for the reason `segments.persona_id` (0012) and
-- `segments.request_id` (0014) do: the reference needs the table, and the table is above. Editing
-- 0008 would make it depend on a migration four files later.
--
-- `set null` rather than cascade, matching both of those: a beat that aired is a beat that aired, and
-- deleting the production row an operator tidied away must not take the words, the audio or the
-- history with it.
alter table deadair.segments add column production_id uuid references deadair.productions (id) on delete set null;

-- Where this beat comes in its production, from 0. What makes the block an ORDER rather than a set:
-- it is how the beats are placed in sequence, and how a beat being drafted is shown the ones already
-- written without being shown the ones that are not.
alter table deadair.segments add column production_ordinal integer
    constraint segments_production_ordinal_check check (production_ordinal is null or production_ordinal >= 0);

-- Both together or neither: a beat with no production is an ordinary segment, and a production_id
-- with no ordinal is a beat with no place in its own programme.
alter table deadair.segments add constraint segments_production_check check ((production_id is null) = (production_ordinal is null));

-- The read every pass makes: this production's beats, in order.
create unique index segments_production_idx on deadair.segments (production_id, production_ordinal) where production_id is not null;

-- migrate:down

drop index if exists deadair.segments_production_idx;
alter table deadair.segments drop constraint if exists segments_production_check;
alter table deadair.segments drop column if exists production_ordinal;
alter table deadair.segments drop column if exists production_id;

drop table if exists deadair.productions;
