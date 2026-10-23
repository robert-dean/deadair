-- migrate:up

-- How many more records the station keeps quiet for: no breaks of its own until that many have
-- started. Zero is not quiet.
--
-- On this row rather than in `deadair.settings` or the running order's own rules, for `active`'s
-- reason and `ran_out`'s: it is a fact about the BROADCAST, a restart must not come back talking, and
-- it has to outlive an extend, a replan and a fresh running order. Writing `rotation.breaks` to say
-- "quiet for ten records" would silently rewrite the standing preference this exists to leave alone,
-- and a lineup rule would be gone with the hour of programming it was asked against.
--
-- Counted in records that START, on the rundown's own confirmation, so it only runs down while
-- somebody can hear it: a wall-clock hour on a station gated on its audience would burn away in
-- silence. Bounded, because a quiet spell has an end by construction; an indefinite one is
-- `rotation.breaks` switched off.
alter table deadair.station_air
    add column breaks_quiet_records integer not null default 0
    constraint station_air_breaks_quiet_records_range check (breaks_quiet_records between 0 and 500);

-- migrate:down

alter table deadair.station_air drop column if exists breaks_quiet_records;
