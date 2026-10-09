-- migrate:up

-- Whether a broadcast built from this slot has its host say where the chart placed each record,
-- carried onto the running order at a changeover the way `mix_in_similar` is.
--
-- NULLABLE, and null means YES: there is no station setting behind it, because a position is only
-- ever said about a record a chart named. `false` is this slot airing a chart without its positions
-- read out. A slot that plays no chart has nothing to say whatever this holds.
alter table deadair.schedule_slots add column chart_positions boolean;

-- migrate:down

alter table deadair.schedule_slots drop column chart_positions;
