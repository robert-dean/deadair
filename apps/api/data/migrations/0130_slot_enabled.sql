-- migrate:up

-- A slot can be switched off without being lost, as a format clock band and an occasion can. The reason it
-- arrives now is the schedule file: what an import adds lands switched off, and a slot had nothing to be
-- switched off with, so an imported show would have aired by itself.
--
-- `ScheduleService` keeps a slot that is off out of every question about what is on, overlap included, so
-- two blocks can only conflict once both are on. That is why the start-minute uniqueness from 0128 has to
-- become partial: a file's slot starting at the same minute as one held here is the ordinary case, and a
-- full constraint would refuse it with a 500 before anyone had chosen to turn it on.

alter table deadair.schedule_slots add column enabled boolean not null default true;

alter table deadair.schedule_slots drop constraint schedule_slots_start_unique;
create unique index schedule_slots_start_unique on deadair.schedule_slots (station_key, starts_at_minutes, days, starts_on, ends_on, recurrence) nulls not distinct
    where enabled;

-- migrate:down

-- A slot that is off goes with the column, because leaving it would put it on the air.
delete from deadair.schedule_slots where not enabled;

drop index deadair.schedule_slots_start_unique;
alter table deadair.schedule_slots
    add constraint schedule_slots_start_unique unique nulls not distinct (station_key, starts_at_minutes, days, starts_on, ends_on, recurrence);

alter table deadair.schedule_slots drop column enabled;
