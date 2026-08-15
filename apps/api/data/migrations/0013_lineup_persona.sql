-- migrate:up

-- Who is HOSTING this broadcast, as distinct from who the station is when nobody said.
--
-- It rides the running order for exactly the reason `brief` does, one column up: `on_end = 'extend'`
-- keeps topping the order up for as long as the station is on, so a host held in a refill's payload
-- would last one batch and the show would quietly change presenter within the hour. A broadcast is a
-- show and a show has a host, which is the shape this makes expressible — "tonight is the
-- crate-digger, tomorrow is the conspiracy host" — where before the DJ was a station-wide switch
-- somebody had to remember to flip back.
--
-- Null is the ordinary state and means the station's own active persona, so nothing changes for an
-- operator who never touches it. `set null` rather than cascade for the same reason: deleting a
-- persona mid-broadcast should drop the show back to the station's host, never take the running
-- order with it.
alter table deadair.station_lineup add column persona_id uuid references deadair.personas (id) on delete set null;

-- migrate:down

alter table deadair.station_lineup drop column persona_id;
