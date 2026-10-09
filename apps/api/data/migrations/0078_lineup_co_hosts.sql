-- migrate:up

-- Who presents BESIDE the host on this broadcast: the co-hosts the schedule put on for tonight.
--
-- The slot's co-hosts are rows in `schedule_slot_hosts` (0077), which is where the schedule keeps
-- them. This is the running order's copy for the broadcast that is on, for `persona_id`'s reason: the
-- people presenting have to ride the order or a refill an hour in would forget who they were.
--
-- An array of ids rather than rows, and without a foreign key, on `putOnAir`'s rule for its host: a
-- persona deleted mid-broadcast is read as gone rather than refusing to broadcast, and the reader
-- drops any id that no longer names a host. Empty and null mean the same thing, one voice.
alter table deadair.station_lineup add column co_host_persona_ids uuid[];

-- migrate:down

alter table deadair.station_lineup drop column co_host_persona_ids;
