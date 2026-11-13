-- migrate:up

-- A slot whose source is a playlist can air it in a shuffled order, rather than the playlist's own.
--
-- A playlist slot airs its playlist in the order its provider lists it, and nothing could change
-- that: the Desk's Shuffle reorders the running order once, as it stands, and an operator with a
-- playlist of one album sorted by title heard that album alphabetically every morning (discussion
-- 868). The order is drawn when the block opens. An operator's takeover that ends inside the block is
-- a second opening and draws it again, as it re-reads the playlist; the running order still shows what
-- airs, because it is built whole at each opening.
--
-- Configuration on the slot row, beside `resume_playlist` (0102), and for its reason. The two do not
-- combine: where a playlist got to means nothing in an order drawn fresh at every opening, so a slot
-- that shuffles ignores `resume_playlist` at its opening and keeps the column as the operator set it,
-- for when the shuffle is turned off again.
alter table deadair.schedule_slots add column shuffle_playlist boolean not null default false;

-- migrate:down

alter table deadair.schedule_slots drop column shuffle_playlist;
