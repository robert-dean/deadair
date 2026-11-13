-- migrate:up

-- A slot can name the festival it is built around, and its show then plays the bill and talks about the
-- festival from its row. Set null when the festival is removed: the show carries on as the show it
-- otherwise is, which is what a deleted playlist's slot does too.
alter table deadair.schedule_slots
    add column festival_id uuid references deadair.festivals (id) on delete set null;

-- migrate:down

alter table deadair.schedule_slots drop column if exists festival_id;
