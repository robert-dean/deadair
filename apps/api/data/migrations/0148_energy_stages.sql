-- migrate:up

-- The energy a stretch of the day builds up or winds down through, as stages in order, the way 0084's
-- `moods` are: `[low, medium, high]` is a show that builds, the reverse one that winds down, a single
-- value one that leans the whole slot one way.
--
-- A record's energy is measured from its audio (its loudness and its brightness, each ranked against the
-- library: `analysis/energy.rank.ts`), and a stage is a LEAN on which records are chosen, never a filter:
-- a record in the stage's third of the records being chosen between is a little more likely, and nothing
-- is kept off the air for it. A hard rule about energy is a mix flow's job, where it is drawn.
--
-- On the slot only. The broadcast a changeover builds carries the stages in its `rules`, as it carries
-- the mix flow, so `station_lineup` needs no column. Null is none, and an empty list is refused rather
-- than stored, so "no lean" has one spelling. Repeats are allowed, as they are for moods: `[low, low,
-- high]` holds the first two thirds of a slot down and lifts the last.
alter table deadair.schedule_slots
    add column energy_stages text[] constraint schedule_slots_energy_stages_check check (
        energy_stages is null
        or (cardinality(energy_stages) between 1 and 4
            and energy_stages <@ array['low', 'medium', 'high']::text[])
    );

-- migrate:down

alter table deadair.schedule_slots drop column energy_stages;
