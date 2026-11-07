-- migrate:up

-- A talk direction: a line the operator gives the presenters for a while ("it's Sam's birthday
-- tonight", "we're snowed in, keep it cosy"), which talk breaks, banter and changeovers hear as a lean
-- until `ends_at`. The genre steer's sibling for what is SAID rather than what is played, and shaped
-- the same way: one per station, and replacing it replaces the row.
--
-- It is a lean and never evidence. Nothing a presenter states as fact may rest on it, and bulletins,
-- jingles and calls never hear it at all; `docs/internals/breaks.md` says why. An expired row is left
-- for the next write to replace, as a steer's is.
create table deadair.talk_directions (
    station_key text primary key default 'main',
    words text not null constraint talk_directions_words_check check (length(btrim(words)) between 1 and 280),
    ends_at timestamptz not null,
    created_at timestamptz not null default now()
);

-- migrate:down

drop table if exists deadair.talk_directions;
