-- migrate:up

-- Which writer a stretch of the day asks first for its breaks, carried onto the running order's
-- rules at a changeover the way `breaks` and the repeat rules are.
--
-- NULLABLE, and null means the station's own `llm.breakWriterOrder`: a show that chose nothing
-- follows the station, and one that chose the station's own words keeps them whatever the station
-- setting says. The values match `PutOnAirInput.writerOrder`, since a changeover builds one of those
-- from this row.
alter table deadair.schedule_slots
    add column writer_order text
    constraint schedule_slots_writer_order_check check (writer_order is null or writer_order in ('model', 'station'));

-- migrate:down

alter table deadair.schedule_slots drop column writer_order;
