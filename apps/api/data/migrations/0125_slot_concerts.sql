-- migrate:up

-- Whether a broadcast built from this slot may have its host mention an artist's next local show,
-- carried onto the running order at a changeover the way `mix_in_similar` is.
--
-- NULLABLE, and null means NO: a date costs a request to somebody else's service per artist, and
-- only a show that asked for it should spend them.
alter table deadair.schedule_slots add column concerts boolean;

-- migrate:down

alter table deadair.schedule_slots drop column concerts;
