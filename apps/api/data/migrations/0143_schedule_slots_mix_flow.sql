-- migrate:up

-- A show's mix flow: the nodes and wires of the rules its records pass before they air.
--
-- A brief says amounts in prose ("black metal only now and then", "a rare pop hit"), and prose reaches
-- only the model, which chooses part of each refill and never sees a running count: the Church show
-- aired black metal on about a quarter of its plays over five Sundays and its gospel line nothing. A
-- flow is what the station enforces itself, on every record it proposes.
--
-- One jsonb document (`MixFlow` in schedule/mix.types.ck) rather than tables, because it is read and
-- written whole by the canvas that draws it and validated whole by `ScheduleService`, and nothing
-- queries inside it. Null on every slot written before this column existed, which is no flow.
alter table deadair.schedule_slots add column mix_flow jsonb;

-- migrate:down

alter table deadair.schedule_slots drop column mix_flow;
