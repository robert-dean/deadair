-- migrate:up

-- Whether a broadcast built from this slot has its host talk between the records, carried onto the
-- running order at a changeover the way `chart_positions` is.
--
-- NULLABLE, and null means THE MODE'S ANSWER: a rotation talks and a setlist does not, exactly as
-- before this column existed. `true` on a setlist is the case it was added for, a chart countdown
-- with a host, which resolves its talk spacing from the station's own settings while the records
-- stay exactly as the chart has them (`resolveRules`). `false` on a rotation is a slot that plays
-- without talking. A feature stays silent whatever this holds.
alter table deadair.schedule_slots add column breaks boolean;

-- migrate:down

alter table deadair.schedule_slots drop column breaks;
