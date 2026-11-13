-- migrate:up

-- Whether a show's written breaks air over a music bed.
--
-- Null is YES, wherever the library holds a bed for the show, because a bed is already something an
-- operator chose by putting it in the library and scoping it; only `false` says anything, and it keeps
-- this show's breaks dry. Null on every slot written before this column existed, which is every slot
-- airing beds as soon as a bed is there for it.
alter table deadair.schedule_slots add column beds boolean;

-- migrate:down

alter table deadair.schedule_slots drop column beds;
