-- migrate:up

-- A special whose day comes from a rule rather than a range, so Halloween night comes round every year
-- by itself and Thanksgiving night lands on the right Thursday. `schedule/occasion.rule.ts` says what
-- each kind of rule means. The rule is the only thing shared with `deadair.occasions`: an occasion is
-- a fact about a date, a special is a show, and neither row points at the other.
--
-- One column rather than the nine `occasions` spreads a rule across, because this table is already
-- wide and only a handful of its rows will ever hold one. The check still says which fields belong to
-- which kind, so a rule the reader cannot act on cannot be stored.
--
-- A row has a range or a rule, never both. The list is capped below `occasions`' 200 because the column
-- is part of the key below, and a B-tree entry has to fit in about 2.7KB.
alter table deadair.schedule_slots
    add column recurrence jsonb,
    add constraint schedule_slots_recurrence_shape check (
        recurrence is null
        or case recurrence ->> 'kind'
            when 'fixed' then recurrence ? 'month' and recurrence ? 'day'
            when 'weekday' then recurrence ? 'month' and recurrence ? 'ordinal' and recurrence ? 'weekday'
            when 'easter' then recurrence ? 'offsetDays'
            when 'calendar' then recurrence ? 'calendar' and recurrence ? 'calendarMonth' and recurrence ? 'day'
            when 'dates' then jsonb_typeof(recurrence -> 'dates') = 'array' and jsonb_array_length(recurrence -> 'dates') between 1 and 100
            else false
        end
    ),
    add constraint schedule_slots_recurrence_or_dates check (recurrence is null or starts_on is null);

-- A special on a rule has no dates, so without this it would count as a weekly row and refuse to start
-- at the minute of the weekly slot it interrupts.
alter table deadair.schedule_slots drop constraint schedule_slots_start_unique;
alter table deadair.schedule_slots
    add constraint schedule_slots_start_unique unique nulls not distinct (station_key, starts_at_minutes, days, starts_on, ends_on, recurrence);

-- A live show is booked for a date, and a date a rule names is one.
alter table deadair.schedule_slots drop constraint schedule_slots_live_is_special;
alter table deadair.schedule_slots add constraint schedule_slots_live_is_special check (
    not live
    or (
        (starts_on is not null or recurrence is not null)
        and source_plugin_id is null
        and source_playlist_id is null
        and source_chart_id is null
        and source_station_playlist_id is null
    )
);

-- migrate:down

delete from deadair.schedule_slots where recurrence is not null;

alter table deadair.schedule_slots drop constraint schedule_slots_live_is_special;
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

alter table deadair.schedule_slots drop constraint schedule_slots_start_unique;
alter table deadair.schedule_slots
    add constraint schedule_slots_start_unique unique nulls not distinct (station_key, starts_at_minutes, days, starts_on, ends_on);

alter table deadair.schedule_slots
    drop constraint schedule_slots_recurrence_or_dates,
    drop constraint schedule_slots_recurrence_shape,
    drop column recurrence;
