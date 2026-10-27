-- migrate:up

-- A special can be a LIVE SHOW: a presenter booked to take the air through the live input.
--
-- At its start the schedule arms the input with the special's name, as the Desk's Go live does, and
-- the station's own programme carries on until the encoder is heard. At its end an input that is
-- still only armed (nobody came) is disarmed; a presenter on the air is never cut by the clock.
--
-- Only a special, because a booking is for a date: a weekly live slot would arm every week whether
-- anybody meant to turn up or not. And no source, because the station plays nothing of the slot's
-- own: what airs until the presenter is heard is the weekly show underneath, which is why the tick
-- never changes over onto a live slot.
alter table deadair.schedule_slots add column live boolean not null default false;

alter table deadair.schedule_slots add constraint schedule_slots_live_is_special check (
    not live
    or (
        starts_on is not null
        and source_plugin_id is null
        and source_playlist_id is null
        and source_chart_id is null
        and source_station_playlist_id is null
    )
);

-- Which nights of a live show the schedule has already armed for, so it arms each night ONCE.
--
-- Without it the tick would re-arm every minute of the show, undoing a Cancel pressed at the Desk and
-- a presenter's early hand-back alike. Keyed on the night, as `schedule_prepared_sets` is, because a
-- show running through midnight is one slot id on two dates. Current state beside the slot rather
-- than on it, since a slot is configuration (migration 0017).
--
-- `armed` says whether the schedule did the arming: false when the input was already armed, counting
-- in or on air as the show began (somebody pressed Go live early), in which case the end of the show
-- leaves it alone. `closed_at` is when the end of the show was dealt with.
create table deadair.schedule_live_arms (
    slot_id uuid not null references deadair.schedule_slots (id) on delete cascade,
    station_key text not null default 'main',
    occurrence date not null,
    armed boolean not null,
    armed_at timestamptz not null default now(),
    closed_at timestamptz,
    primary key (slot_id, occurrence)
);

-- migrate:down

drop table deadair.schedule_live_arms;

alter table deadair.schedule_slots drop constraint if exists schedule_slots_live_is_special;
alter table deadair.schedule_slots drop column if exists live;
