-- migrate:up

-- What the operator thought of something the station said.
--
-- Nothing judged what the station SAID. `script_history` records every attempt with its writer, its
-- model, its template and its neighbours, and `CharacterFault` gives a closed vocabulary of ways a
-- script is not the character — but that is a rubric rather than an opinion, and optimising against
-- it is the trap `overusedWords` already documents one level down. The audience is a count, and a
-- listener who leaves during a break and a listener whose train went into a tunnel are the same
-- number. So the operator is the judge or there is no judge.
--
-- A SEPARATE TABLE rather than a column on `deadair.script_history`, which is deliberately
-- append-only with no `updated_at` and no trigger: a row there is a fact about a moment, and a
-- rating is an edit. A column would make that table take edits, which is the one thing its shape
-- refuses. Here the edit is ordinary, so this table carries the trigger that one does not.
--
-- On the ATTEMPT and not on the persona, the segment or the template. One row per attempt is what
-- lets the FLOOR's phrasings be rated as well as the model's, which is the only way an operator
-- learns which of `rotation.breakTemplates` actually land. Every narrower verdict — this persona,
-- this template, this writer, this model — is a `group by` over rows that already carry all four,
-- where a rating column on `deadair.personas` would answer one of those and foreclose the rest.
--
-- `on delete cascade` rather than `set null`, which is the opposite call to everything else pointing
-- at a station table: a rating whose script is gone is not a fact that outlived its subject, it is an
-- orphan. The nightly sweep (`render.scriptHistoryDays`) therefore takes both, which is right for as
-- long as everything reading a rating reads it inside the retention window.
--
-- The primary key is `(station_key, script_id)`, so one station holds one opinion per attempt and
-- rating something again replaces it rather than accumulating a history of moods.
create table deadair.script_ratings (
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now() check (updated_at >= created_at),
    -- Whose opinion this is, as on every other station-owned table.
    station_key text not null default 'main',
    script_id uuid not null references deadair.script_history (id) on delete cascade,
    -- The catalog's spelling exactly, mapped through `catalog/rating.ts` and nowhere else. The
    -- ORDERING is what makes the column a number, and NEUTRAL IS A REAL STATE: rating something back
    -- to nothing is a thing an operator does, and it has to be distinguishable from never having
    -- listened, which is the absence of a row.
    rating smallint not null check (rating in (-1, 0, 1)),
    -- Who said so, nullable and left behind when the actor goes, exactly as `station_events.actor_id`
    -- is: whose opinion it was is worth keeping and is not worth keeping an actor row alive for.
    actor_id uuid references deadair.actors (id) on delete set null,
    primary key (station_key, script_id)
);
select deadair.add_updated_at_trigger('deadair.script_ratings');

-- The read is always "what did they think of these attempts", joining from a page of history, so the
-- index that matters is the primary key's own. This one is for the other direction: the persona
-- notebook's distil pass will ask for a character's scripts EXCLUDING the ones thumbed down, which
-- is a scan over ratings by value rather than by script.
create index script_ratings_disliked_idx on deadair.script_ratings (station_key, rating) where rating < 0;

-- migrate:down

drop table if exists deadair.script_ratings;
