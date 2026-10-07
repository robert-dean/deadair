-- migrate:up

-- When a provider refused a copy, beside the refusal itself.
--
-- `playable = false` said THAT a provider will never serve a copy and not WHEN, while the station's
-- own bench (`missing_at`) has always carried its moment. The moment is what an acknowledgement is
-- measured against: an operator who dismissed "no copy left that will play" has accepted the records
-- benched at that point, and a copy refused AFTERWARDS is news they have not seen. Null on every copy
-- refused before this column existed, which reads as "longer ago than any acknowledgement", and is
-- cleared by the same operator action that clears the refusal.
alter table deadair.track_sources
    add column refused_at timestamptz;

-- When an operator last accepted that this record has no copy that will play.
--
-- Not a state of its own and not a way out of the catalog: a record carrying this is still benched,
-- the catalog's filter still lists it, and the draw still cannot choose it. It quiets the desk's
-- attention row for exactly this record and exactly this bench, and it stops covering it the moment a
-- copy of the record is written off or refused later than it was set.
alter table deadair.tracks
    add column bench_acknowledged_at timestamptz;

-- migrate:down

alter table deadair.tracks
    drop column bench_acknowledged_at;

alter table deadair.track_sources
    drop column refused_at;
