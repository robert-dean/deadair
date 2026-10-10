-- migrate:up

-- Whether a broadcast built from this slot is a request show, and how many records follow each
-- request on it, carried onto the running order's rules at a changeover the way `breaks` is.
--
-- NULLABLE, and null means NO for the first and the default (4) for the second: a request show is a
-- kind of show rather than a way the station always behaves, so there is no station setting for a
-- null to fall through to.
alter table deadair.schedule_slots add column request_show boolean;
alter table deadair.schedule_slots
    add column request_follow_on integer
    constraint schedule_slots_request_follow_on_range check (request_follow_on is null or request_follow_on between 0 and 10);

-- migrate:down

alter table deadair.schedule_slots drop column request_follow_on;
alter table deadair.schedule_slots drop column request_show;
