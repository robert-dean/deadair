-- migrate:up

-- A link said OVER a record, kept in the as-run log beside the record it was said over.
--
-- Every other row is one item in a sequence: it opens when the player says the item started and is
-- closed by the next one, so the log reads as one thing on air at a time. A talked-up or talked-out
-- link breaks that on purpose, since it is heard at the same time as a record, and it never reached
-- the log at all: the player is not handed it as an item, so no aired edge ever named it. On
-- 2026-11-06 two links spoken over the intro of "Sentient" and the end of "Ghosts 'n' Stuff" aired
-- with nothing in this table to say so, and the morning read as three records in a row with no talk.
--
-- A row with this set carries its own start and end, written once from the cue's offset into its
-- record and the segment's measured length, and is left out of everything that closes a row on the
-- next item's start. Without that, a link said two seconds into a record would end the record there.
alter table deadair.as_run add column spoken_over boolean not null default false;

-- migrate:down

alter table deadair.as_run drop column spoken_over;
