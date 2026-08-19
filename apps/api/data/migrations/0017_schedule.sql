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
    -- When it starts, as minutes past midnight ON THE STATION'S CLOCK (`station.timezone`).
    --
    -- Only a START, and the absence of an end is the design. A slot runs until the next one begins
    -- and the last of the week wraps round to the first, so every instant lands somewhere: there is
    -- no gap to represent, no overlap to resolve, and an operator who wants the evening to finish
    -- simply starts the next slot. `docs/todo/station-moment.md` wants its mood bands in this exact
    -- shape, which is why it is worth being deliberate: that feature is a column here later rather
    -- than a second table.
    --
    -- Minutes rather than a `time`, because the whole point is that this is a wall-clock reading in a
    -- named zone rather than an instant, and a `time` column invites arithmetic that is wrong twice a
    -- year. The resolver compares it against what the station's clock currently says.
    starts_at_minutes integer not null check (starts_at_minutes >= 0 and starts_at_minutes < 1440),
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
    -- Free text and deliberately NOT a bag of genre, era and mood constraints. A brief is read by a
    -- model, which is how every other steering instruction here reaches one; a parallel structured
    -- filter would be a second, weaker answer to the same question, and `chart.set.generator.ts`
    -- already argues that approximating an instruction is what the deterministic layer is not
    -- allowed to do.
    brief text not null default '',
    -- What a broadcast built from this slot IS, and what happens when it runs out. Same vocabulary
    -- and same defaults as `station_lineup`, because a changeover builds one of those from this.
    mode text not null default 'rotation' constraint schedule_slots_mode_check check (mode in ('rotation', 'setlist', 'feature')),
    on_end text not null default 'extend' constraint schedule_slots_on_end_check check (on_end in ('extend', 'repeat', 'stop')),

    -- Two slots starting at the same minute is an operator mistake with no coherent answer, so it is
    -- refused rather than resolved by an ordering nobody chose. It is per `days` as well because a
    -- weekday slot and a weekend one legitimately share a start time.
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

-- migrate:down

alter table deadair.station_lineup drop column slot_id;

drop table deadair.schedule_slots;
