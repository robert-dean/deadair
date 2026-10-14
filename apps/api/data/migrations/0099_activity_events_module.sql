-- migrate:up

-- `events` joins the activity feed's filter axis, because the station switching an event destination
-- off after it failed twenty times in a row is something an operator has to be able to see without
-- opening the destination. None of the existing values fits: it is not playout, and it is not a
-- plugin.
--
-- Dropped and re-added rather than altered, on 0040's reasoning: Postgres has no `alter constraint`
-- for a check body, and adding a value only widens what passes.
alter table deadair.station_events drop constraint station_events_module_check;

alter table deadair.station_events
    add constraint station_events_module_check
    check (module in ('playout', 'director', 'render', 'catalog', 'plugins', 'storage', 'events'));

-- migrate:down

-- The feed's own record of a destination switching off, which nothing reads but a person.
delete from deadair.station_events where module = 'events';

alter table deadair.station_events drop constraint station_events_module_check;

alter table deadair.station_events
    add constraint station_events_module_check
    check (module in ('playout', 'director', 'render', 'catalog', 'plugins', 'storage'));
