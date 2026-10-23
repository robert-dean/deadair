-- migrate:up

-- The three repeat rules a stretch of the day may lift, carried onto the running order's rules at a
-- changeover the way `breaks` and `chart_positions` are.
--
-- A one-artist hour is refused by all three at once: the artist cooldown turns away the second
-- record, the per-artist cap trims a batch to two, and the repeat window keeps a small pool from
-- coming round. So all three are here, and one "ignore the repeat rules" switch would have changed
-- nothing an operator could hear.
--
-- NULLABLE, and null means the mode's own answer: the station's `rotation.*` setting for a rotation,
-- none for a setlist or a feature. Zero is a value, the lift itself. Columns rather than a jsonb
-- bag, following 0075, 0079 and 0081, so the slot holds its rules one way. The ranges match
-- `PutOnAirInput`, since a changeover builds one of those from this row.
alter table deadair.schedule_slots
    add column repeat_window_days integer
    constraint schedule_slots_repeat_window_days_range check (repeat_window_days is null or repeat_window_days between 0 and 365);
alter table deadair.schedule_slots
    add column artist_cooldown_minutes integer
    constraint schedule_slots_artist_cooldown_minutes_range check (artist_cooldown_minutes is null or artist_cooldown_minutes between 0 and 1440);
alter table deadair.schedule_slots
    add column max_per_artist integer
    constraint schedule_slots_max_per_artist_range check (max_per_artist is null or max_per_artist between 0 and 100);

-- migrate:down

alter table deadair.schedule_slots drop column max_per_artist;
alter table deadair.schedule_slots drop column artist_cooldown_minutes;
alter table deadair.schedule_slots drop column repeat_window_days;
