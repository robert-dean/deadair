-- migrate:up

-- The weekdays a `clock` band happens on, Sunday 0, as a jsonb array of integers. EMPTY MEANS EVERY DAY.
--
-- `schedule_slots.days`'s shape and its reasons (migration 0017): an empty list rather than all seven so
-- "every day" is what an operator who never thought about weekdays gets, and jsonb rather than `integer[]`
-- because the row is edited as JSON by the console. Asked for by a news show that runs on weekdays: the
-- band is the only thing that says when a programme the station makes is made, and before this it could
-- say "every day at six" and nothing narrower.
--
-- Read only for a `clock` band. An `interval` band is a spacing rule and has no day to be on.
alter table deadair.clock_bands
    add column days jsonb not null default '[]'::jsonb
    constraint clock_bands_days_check check (jsonb_typeof(days) = 'array');

-- migrate:down

alter table deadair.clock_bands drop column if exists days;
