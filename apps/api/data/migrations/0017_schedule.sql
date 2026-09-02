-- migrate:up

-- The station's daypart schedule: which source, which host and which brief, by the wall clock.
--
-- Its own file rather than an addition to `0007_director.sql`, which is where the running order
-- lives, for the reason `0012_personas.sql` is its own file: this is a stored CONFIGURATION document
-- that the director reads, not a piece of broadcast state the director owns. The foreign key below
-- settles it either way — personas do not exist until 0012, so a table in 0007 could not reference
-- one, which is exactly why `station_lineup.persona_id` had to arrive separately in 0013.
--
-- **This table is read by a pure resolver and by nothing else.** `docs/decisions/on-air-ownership.md`
-- is explicit that the schedule must be a document, a resolver and a timer that posts commands, and
-- must never become a second stateful owner of what airs. So there is no "current slot" column here
-- and there never should be: the running order carries which slot it belongs to, and the director is
-- its only writer.
create table deadair.schedule_slots (
    id uuid not null default gen_random_uuid() primary key,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now() check (updated_at >= created_at),
    -- Whose schedule this is. Present from the first migration for the same reason it is on every
    -- other station-owned table: the second station is a row rather than a migration.
    station_key text not null default 'main',
    -- What the operator calls this stretch of the day. Becomes the broadcast's `name`, so it is the
    -- label a console shows rather than an identity anything looks up.
    label text not null default '',
    -- When it starts and ends, as minutes past midnight ON THE STATION'S CLOCK (`station.timezone`).
    --
    -- **A slot is a BLOCK, and this used to be only a start.** It ran until the next slot began, so
    -- every instant landed somewhere and there was no gap to represent — which was tidy and meant
    -- something the operator did not: one slot at six in the morning was on air around the clock,
    -- for ever, because there was no next one to end it. Every awkwardness that shape produced was
    -- the same awkwardness (a whole-day block rendered as an all-day banner, a block at the top of a
    -- column belonging to the night before, a lower edge that edited a different row) and it is now
    -- one fix rather than four workarounds.
    --
    -- What it costs is a GAP, which is a real state and has a real answer: the sustaining source in
    -- `schedule.sustaining*`. A gap plays that rather than falling silent, so the schedule never
    -- gains the power to stop a running station and `Stop` keeps meaning only what an operator meant
    -- by it.
    --
    -- `ends_at_minutes` BEFORE the start means the block runs past midnight (`22:00` to `02:00`),
    -- which is ordinary for a late show. Equal to it means a full twenty-four hours, which needs no
    -- rule of its own: the wrap arithmetic already covers from the start to midnight and from
    -- midnight back to the start, and those two are the whole day. There is no competing reading,
    -- because a zero-length block is not a thing anybody wants — and without it a station that
    -- genuinely runs one show around the clock could not say so.
    --
    -- Minutes rather than a `time` pair, because the whole point is that these are wall-clock
    -- readings in a named zone rather than instants, and a `time` column invites arithmetic that is
    -- wrong twice a year. The resolver compares them against what the station's clock says.
    starts_at_minutes integer not null check (starts_at_minutes >= 0 and starts_at_minutes < 1440),
    ends_at_minutes integer not null check (ends_at_minutes >= 0 and ends_at_minutes < 1440),
    -- The weekdays it runs on, Sunday 0, as a jsonb array of integers.
    --
    -- **Empty means EVERY day**, which is the ordinary case, and that is why it is an empty list
    -- rather than all seven written out: an operator who has never thought about weekdays should not
    -- have to fill in a set to say so, and a migration that seeded seven would make "every day"
    -- indistinguishable from "somebody chose all of them".
    --
    -- jsonb rather than `integer[]` for the reason the persona sheet's lists are: the row crosses the
    -- wire and is edited as JSON by the console, and a Postgres array is the one shape needing a
    -- translation at both ends.
    days jsonb not null default '[]'::jsonb,
    -- Where this slot's records come from, in the shape `putOnAir` already takes: a plugin and one of
    -- its playlists. Both null is a slot the station fills itself, which is what a rotation with no
    -- playlist behind it is.
    source_plugin_id text,
    source_playlist_id text,
    -- Who hosts this stretch of the day. Null means the station's own active persona, exactly as on
    -- `station_lineup`, and `set null` for the same reason 0013 gives: deleting a persona should drop
    -- the slot back to the station's host, never take the schedule with it.
    persona_id uuid references deadair.personas (id) on delete set null,
    -- What the operator asks this stretch of the day to play, in their own words. Copied onto the
    -- running order at a changeover, where it does the job it already does: outlive the batch it
    -- produced, because `on_end = 'extend'` keeps asking for more.
    --
    -- Free text and deliberately NOT a bag of genre and mood constraints. A brief is read by a
    -- model, which is how every other steering instruction here reaches one; a parallel structured
    -- filter would be a second, weaker answer to the same question, and `chart.set.generator.ts`
    -- already argues that approximating an instruction is what the deterministic layer is not
    -- allowed to do.
    --
    -- **A PERIOD is the one exception**, and it is the columns below rather than words in here. This
    -- comment used to say "genre, era and mood" and the era half of it was wrong: a dropdown is
    -- weaker than prose for a style and STRONGER for a year, the station had already conceded that
    -- much (`set.prompt.ts` tells the model never to write "80s" in a query and to pass
    -- `yearFrom`/`yearTo` instead), and there is nothing to approximate in a range. What it buys is
    -- the deterministic draw honouring a decade too, which prose can never do. See
    -- `0007_director.sql`, where the same pair rides the running order this slot builds.
    brief text not null default '',
    -- The period this stretch of the day plays, copied onto the running order at a changeover
    -- exactly as `brief` is. Same meaning, same bounds, same null-is-eligible rule.
    era_from integer,
    era_to integer,
    constraint schedule_slots_era_check check (era_from is null or era_to is null or era_from <= era_to),
    constraint schedule_slots_era_from_range check (era_from is null or (era_from >= 1900 and era_from <= 2100)),
    constraint schedule_slots_era_to_range check (era_to is null or (era_to >= 1900 and era_to <= 2100)),
    -- What a broadcast built from this slot IS, and what happens when it runs out. Same vocabulary
    -- and same defaults as `station_lineup`, because a changeover builds one of those from this.
    mode text not null default 'rotation' constraint schedule_slots_mode_check check (mode in ('rotation', 'setlist', 'feature')),
    on_end text not null default 'extend' constraint schedule_slots_on_end_check check (on_end in ('extend', 'repeat', 'stop')),
    -- Whether somebody phones in during this stretch of the day, carried onto the running order at a
    -- changeover the way the brief and the period are.
    --
    -- NULLABLE, and that third state is the point rather than an oversight: null leaves the station's
    -- own `rotation.callins` standing, which is what an operator who never thought about the phone
    -- means, where `false` would be this slot overruling a station that takes calls every hour. It is
    -- the same three-way `PutOnAirInput.callins` already has, and a scheduled breakfast show is
    -- exactly the thing that should be able to take calls when a hand-driven broadcast can.
    callins boolean,

    -- Two slots starting at the same minute on the same days is an operator mistake with no coherent
    -- answer, so it is refused rather than resolved by an ordering nobody chose. Blocks that OVERLAP
    -- without sharing a start are refused too, but in `ScheduleService` rather than here: the check
    -- has to expand an empty `days` to every day and compare two ranges that may wrap midnight,
    -- which is not something a table constraint can say.
    constraint schedule_slots_start_unique unique (station_key, starts_at_minutes, days)
);

select deadair.add_updated_at_trigger('deadair.schedule_slots');

-- Which slot this broadcast belongs to, or null for one nothing scheduled.
--
-- The idempotence mechanism for the tick, and it lives HERE rather than in the schedule module for
-- the reason the brief and the host do: it is a fact about the running order, and the director is the
-- only thing that may write one. A "current slot" held next to the schedule would be the second
-- stateful owner `on-air-ownership.md` exists to prevent.
--
-- **An operator's own `putOnAir` stamps it too**, with whichever slot is in force at that moment.
-- That is what makes a manual takeover hold until the NEXT slot begins rather than being stomped by
-- the tick a minute later: the ids match until the boundary moves, and then they do not. Leaving it
-- null for a manual start would have needed a second rule and a timestamp to go with it.
--
-- `set null` because a slot an operator deleted mid-broadcast says nothing about what is airing; the
-- show carries on and the next boundary decides.
alter table deadair.station_lineup add column slot_id uuid references deadair.schedule_slots (id) on delete set null;

-- The station's FORMAT CLOCK: a bulletin at half past, an ident at the top of the hour, a second
-- sort of break on its own interval.
--
-- Beside `schedule_slots` because they are two halves of one question. A slot says what this stretch
-- of the day PLAYS and who hosts it; a band says what the station SAYS while it does. Neither owns
-- the running order: both are read by the planner on its pass, and the director is still the only
-- writer of what airs.
--
-- **This was a settings text box** (`rotation.clockBands`), one rule per line, parsed with a regular
-- expression that dropped anything it could not read. That was right while a band was three tokens
-- an operator could hold in their head, and it stops being right the moment a band REFERENCES
-- something: a mistyped line is silence at a time nobody chose, and the only report of it is a log
-- line. A row cannot be malformed, and a row can carry a foreign key.
create table deadair.clock_bands (
    id uuid not null default gen_random_uuid() primary key,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now() check (updated_at >= created_at),
    station_key text not null default 'main',
    -- Which sort of break this slot wants. Free text, exactly as `segments.kind` is and for the same
    -- reason: a station that wants sponsor spots writes `sponsor`, drops the recordings in the
    -- inbox, and needs no migration and no code. The planner asks the writer registry and the
    -- segment library what can produce one, and says so once when neither can.
    kind text not null,
    -- Which of the two shapes this is. `clock` is a time of day and `interval` is a spacing rule.
    at text not null constraint clock_bands_at_check check (at in ('clock', 'interval')),
    -- `clock`: minutes past the hour, and the hour it happens at. A null hour is EVERY hour, which
    -- is the common case (`:30 news`) rather than a missing value.
    hour integer check (hour is null or (hour >= 0 and hour < 24)),
    minute integer check (minute is null or (minute >= 0 and minute < 60)),
    -- `interval`: how far apart, in whole minutes.
    --
    -- **Plain minutes rather than an `interval` column**, which is the same call `starts_at_minutes`
    -- above makes against `time`, and for a related reason. Every occurrence here is computed in JS
    -- against `Intl` (see `nextOccurrence`, which walks the clock forward precisely so a change in
    -- either direction cannot land a band an hour out); nothing does interval arithmetic in SQL, the
    -- value crosses the wire to a console that edits it as JSON, and `interval '1 mon'` would be
    -- expressible and is not a fixed number of milliseconds that a spacing rule could use.
    every_minutes integer check (every_minutes is null or every_minutes > 0),
    -- ORDER IS PREFERENCE, which is what line order was in the box: the planner reads bands top to
    -- bottom and an operator who wants one rule to win a contested boundary moves it up. The same
    -- shape `BreakWriterRegistry` and `SetGeneratorChain` settle precedence with.
    position integer not null default 0,
    -- What commenting a line out used to do. A rule turned off without being lost.
    enabled boolean not null default true,

    -- The two shapes are exclusive, and each needs its own half filled in. Said here rather than in
    -- a service because it is a property of the row and not of any request that writes one.
    constraint clock_bands_shape_check check (
        (at = 'clock' and minute is not null and every_minutes is null)
        or (at = 'interval' and every_minutes is not null and hour is null and minute is null)
    )
);

select deadair.add_updated_at_trigger('deadair.clock_bands');

-- The planner's read, on every pass that has somewhere to put something: this station's bands, in
-- the order the operator put them in.
create index clock_bands_station_idx on deadair.clock_bands (station_key, position, id);

-- migrate:down

drop table if exists deadair.clock_bands;

alter table deadair.station_lineup drop column slot_id;

drop table deadair.schedule_slots;
