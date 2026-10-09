-- migrate:up

-- The first records of a show, chosen before it starts.
--
-- A slot with no playlist or chart behind it is only a brief, and until now its running order was
-- built EMPTY at the boundary: the director sent a refill, the model chose a set, the set downloaded,
-- and the mount was silent for all of it (two to three minutes per show on the live station,
-- 2026-10-08 and 09). A set chosen ahead of the boundary is what the changeover airs instead, and the
-- ordinary refill takes over from there.
--
-- Prepared material rather than a running order: the director is still the only writer of
-- `station_lineup`, and this is read once by the changeover that consumes it, through the same
-- `putOnAir` an operator's playlist goes through.
--
-- ONE row per slot, for the next night it runs: a set is prepared for a particular night, and one
-- prepared for a night that never aired (the station was stood down) is simply not that night's and
-- is replaced by the next preparation. `occurrence` is the date that night began, as
-- `station_lineup.slot_occurrence` holds it, because a block running through midnight is the same id
-- on both nights.
--
-- In Postgres rather than Redis, which holds sessions and promises that losing it costs a sign-in
-- and nothing else. The foreign key is the other half: deleting a slot takes its set with it, and
-- editing one deletes the set in `ScheduleRepository.update`, since it was chosen against the brief
-- the edit replaced.
create table deadair.schedule_prepared_sets (
    slot_id uuid primary key references deadair.schedule_slots (id) on delete cascade,
    station_key text not null default 'main',
    occurrence date not null,
    -- `RundownTrack[]`, in airing order, JSON-safe as the running order's own items are.
    tracks jsonb not null,
    prepared_at timestamptz not null default now()
);

-- migrate:down

drop table deadair.schedule_prepared_sets;
