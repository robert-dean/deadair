-- migrate:up

-- A slot that runs on DATES rather than every week: Halloween night, the week before Christmas, a
-- one-off evening somebody else presents.
--
-- `0017_schedule.sql` made the schedule a repeating week, and its overlap rule a refusal rather than a
-- precedence, on the argument that a precedence rule is a fact about the schedule only the code knows.
-- A special is the one exception, and it is safe for the reason that argument gives: the timetable is
-- drawn per DATE, so the special and the weekly blocks it cuts into are both on the grid where the
-- operator can see them. On its dates a special wins over the weekly schedule for its hours; two
-- specials still may not overlap each other.
--
-- A special is a row in this table rather than one of its own, because everything a slot already is
-- (a source, a host, a brief, a period, a mood, the id the running order is stamped with and the id a
-- block rule names) is everything a special needs too.
--
-- `starts_on` and `ends_on` are inclusive, and both or neither are set: neither is an ordinary weekly
-- slot. `days` still applies inside the range, so "the Fridays in December" is a range and a mask.
-- `yearly` reads only the month and day of each end and repeats every year; such a range may run past
-- New Year, which is why it is stored as two real dates in order (2026-12-31 to 2027-01-01) and is
-- bounded below a year, since a yearly range of a year or more would be every day.
alter table deadair.schedule_slots
    add column starts_on date,
    add column ends_on date,
    add column yearly boolean not null default false,
    add constraint schedule_slots_dates_paired check ((starts_on is null) = (ends_on is null)),
    add constraint schedule_slots_dates_ordered check (starts_on is null or starts_on <= ends_on),
    add constraint schedule_slots_yearly_dated check (not yearly or starts_on is not null),
    add constraint schedule_slots_yearly_span check (not yearly or ends_on < starts_on + interval '1 year');

-- The start-minute uniqueness from 0017 has to admit a special starting at the same minute as the
-- weekly slot it interrupts. NULLS NOT DISTINCT keeps two WEEKLY rows at one minute on the same days
-- a conflict, exactly as before: with the default, their null dates would make every pair distinct.
alter table deadair.schedule_slots drop constraint schedule_slots_start_unique;
alter table deadair.schedule_slots
    add constraint schedule_slots_start_unique unique nulls not distinct (station_key, starts_at_minutes, days, starts_on, ends_on);

-- migrate:down

alter table deadair.schedule_slots drop constraint schedule_slots_start_unique;
delete from deadair.schedule_slots where starts_on is not null;
alter table deadair.schedule_slots add constraint schedule_slots_start_unique unique (station_key, starts_at_minutes, days);

alter table deadair.schedule_slots
    drop constraint schedule_slots_yearly_span,
    drop constraint schedule_slots_yearly_dated,
    drop constraint schedule_slots_dates_ordered,
    drop constraint schedule_slots_dates_paired,
    drop column yearly,
    drop column ends_on,
    drop column starts_on;
