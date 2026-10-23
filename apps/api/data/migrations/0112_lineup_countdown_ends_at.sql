-- migrate:up

-- When the slot a countdown was fitted to ends, so the director can ask the fit's question again of
-- what is left (`overdueCountdown` in `chart.airtime.ts`). A countdown is fitted once, at `putOnAir`,
-- and the audience gate, a run of requests or breaks that ran long all push number one past the
-- changeover that then drops it: the US countdown on 2026-10-23 lost its top eleven that way.
--
-- On the order rather than read from the slot, because an operator can air a countdown by hand inside
-- a slot set to a different order, and the slot's row would then say nothing about it. NULL for every
-- order that is not a countdown cut to a slot, which is the ordinary state.
alter table deadair.station_lineup add column countdown_ends_at timestamptz;

-- migrate:down

alter table deadair.station_lineup drop column countdown_ends_at;
