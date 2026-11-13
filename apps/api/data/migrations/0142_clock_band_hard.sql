-- migrate:up

-- Whether a `clock` band is a HARD marker: it airs at its time exactly, never before it, rather than at the
-- first boundary after it. False is the soft marker every band was before this column, so nothing that is on
-- the clock now changes how it lands.
--
-- When the running order comes up early the director waits for the time (a fill of exactly the gap), and
-- when it runs late the record playing across the time is cut to end on it. Which of the two, and by how
-- much, is decided by the director at hand-over from what is actually on air. See `docs/internals/breaks.md`
-- § "Hard markers".
--
-- Read only for a `clock` band. An `interval` band is a spacing rule and has no time to hit.
alter table deadair.clock_bands
    add column hard boolean not null default false;

-- migrate:down

alter table deadair.clock_bands drop column if exists hard;
