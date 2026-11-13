-- migrate:up

-- The music bed a break airs over, chosen when the break is planned.
--
-- Chosen at PLAN time and kept on the row, for the reason a soundboard hit is resolved at write
-- time onto `segments.pads`: only the planner knows which show the break airs in, and a render
-- asking again would have to ask who is on NOW, which after a changeover is another show with
-- another sound. A re-render keeps the bed it was planned with for the same reason.
--
-- A bed is itself a segment (kind `bed`, an operator's recording), so this is a self-reference.
-- `on delete set null` because deleting a bed must never cost a break: one that has lost its bed
-- airs as words, which is what every break did before beds existed. Null on every row that has
-- none, which is every row written before this column existed.
alter table deadair.segments add column bed_segment_id uuid references deadair.segments (id) on delete set null;

-- What makes deleting a bed cheap: the foreign key's `set null` has to find every row naming it.
create index segments_bed_segment_id_idx on deadair.segments (bed_segment_id) where bed_segment_id is not null;

-- migrate:down

drop index if exists deadair.segments_bed_segment_id_idx;
alter table deadair.segments drop column bed_segment_id;
