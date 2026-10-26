-- migrate:up

-- Whether the station stood down because a presenter took the air through the live input, rather
-- than because somebody stopped it or its running order ran out.
--
-- A live stand-down is the one that undoes itself: when the presenter hands back, the station picks
-- its running order up again at the next record. Every other stand-down stays down until somebody
-- starts it. So the hand-back has to know which kind it is looking at, and it has to know after a
-- restart, because a show can outlast the API: stored where `active` and `ran_out` are, for their
-- reason. Cleared by every `goOnAir` and by any other stand-down, so an operator who stops the
-- station during a show is not overruled by the hand-back.
alter table deadair.station_air add column stood_down_for_live boolean not null default false;

-- migrate:down

alter table deadair.station_air drop column if exists stood_down_for_live;
