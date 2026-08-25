-- migrate:up

-- What has happened to a character, in its own telling.
--
-- `deadair.persona_notes` is what a character ACCUMULATED and `personas.background` is the couple of
-- grounded sentences its author typed. Neither is an anecdote: background is sent whole on every
-- prompt, so it has to stay two lines, and a note is one sentence distilled out of what was actually
-- broadcast. Nowhere could hold "the night you saw three lights over the desert outside Barstow",
-- which is the thing a listener remembers a presenter for.
--
-- A TABLE for `persona_notes`' reason exactly: a list an operator and the station both append to,
-- whose entries can be turned down in a way that has to outlive the pass that proposed them. And a
-- table rather than a sheet column for one more reason of its own, which is the whole point of this
-- migration: **a story GROWS**. It gets told, and the next telling has a detail the last one did
-- not, which is a child row rather than a rewrite.
create table deadair.persona_stories (
    id uuid not null default gen_random_uuid() primary key,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now() check (updated_at >= created_at),
    -- Whose stories these are, as on every other station-owned table.
    station_key text not null default 'main',
    -- WHICH character, as the persona's own key and with no foreign key, exactly as
    -- `persona_notes.persona_key` and `script_history.persona_key` hold it. The key is the stable
    -- name, and a story is about a character rather than about a row.
    persona_key text not null check (length(btrim(persona_key)) > 0),
    -- A short handle: "The Barstow lights". NEVER spoken — it is what the console lists, what a log
    -- line names, and what a proposal identifies itself as. The words that go on air are `story`.
    title text not null check (length(btrim(title)) > 0),
    -- The telling, in the character's own voice, a few sentences long. Long enough that the
    -- deterministic writer can simply speak it, which is what makes the story break's floor unable
    -- to fail: this column is already the script.
    story text not null check (length(btrim(story)) > 0),
    -- `active` can be told. `suggested` is the enrichment pass proposing one and waiting. `rejected`
    -- is an operator having turned that down, kept rather than deleted for `pronunciations`' reason:
    -- the pass reads the same catalogue back and would propose it forever.
    state text not null constraint persona_stories_state_check check (state in ('active', 'suggested', 'rejected')),
    -- Who says so. `model` is the enrichment pass writing from what the station already holds.
    origin text not null constraint persona_stories_origin_check check (origin in ('operator', 'model')),
    -- Where a proposal came from, in the station's own words ("from the notes on Anvil's Metal on
    -- Metal, which this station owns"). Null for anything an operator wrote.
    --
    -- **This is NOT evidence, and must never be given `facts`' posture.** `facts.source_url` and
    -- `source_quote` are `not null` because a claim about the world with no source must not be
    -- EXPRESSIBLE. A story is the character's own and the station stands behind none of it: there is
    -- nothing here to verify, and a nullable column saying where an idea came from is for the
    -- operator reading the proposal. What keeps that safe is at the other end, in the prompt, where a
    -- story may never be attached to a record as a fact about the record.
    source text,
    -- The rotation, read the way `persona_notes.last_used_at` is and stamped by a separate call, so a
    -- reader that is not putting anything on air — a rehearsal — does not spend it.
    last_told_at timestamptz,
    -- How often this has gone out, which the prompt reads: a story a regular listener may already
    -- have heard is told differently from one nobody has.
    times_told integer not null default 0 check (times_told >= 0)
);

-- One story per character per title. Partial for `pronunciations_written_idx`'s exact reason: a
-- rejected proposal must not stand between an operator and their own story about the same night.
-- This is also what stops the enrichment pass proposing the same story every night.
create unique index persona_stories_title_idx on deadair.persona_stories (station_key, persona_key, lower(btrim(title))) where state <> 'rejected';

-- The read every break makes: one character's tellable stories, least recently told first.
create index persona_stories_active_idx on deadair.persona_stories (station_key, persona_key, last_told_at nulls first) where state = 'active';

select deadair.add_updated_at_trigger('deadair.persona_stories');

-- What a story has picked up since it was written.
--
-- One row per detail rather than a rewrite of `story`, and the difference is what an operator can
-- act on: a model that adds "and the radio in the truck went to static a mile before" has made one
-- claim about the character, which arrives `suggested` and can be turned down without touching the
-- story it was hung on. A rewrite would offer them a whole re-telling to accept or refuse, with
-- nothing saying which sentence was new.
create table deadair.persona_story_details (
    id uuid not null default gen_random_uuid() primary key,
    created_at timestamptz not null default now(),
    -- CASCADE, against the habit of every other reference here, and for `clock_bands.topic_id`'s
    -- reason read the other way: a detail whose story is gone is not a smaller story, it is a
    -- fragment nothing can render and nobody can place.
    story_id uuid not null references deadair.persona_stories (id) on delete cascade,
    detail text not null check (length(btrim(detail)) > 0),
    state text not null constraint persona_story_details_state_check check (state in ('active', 'suggested', 'rejected')),
    origin text not null constraint persona_story_details_origin_check check (origin in ('operator', 'model')),
    -- Where a proposal came from. See the note on `persona_stories.source`: not evidence.
    source text
);

-- One detail per story per wording, partial for the reason above it.
create unique index persona_story_details_detail_idx on deadair.persona_story_details (story_id, lower(btrim(detail))) where state <> 'rejected';

-- The read that goes with `persona_stories_active_idx`: what this story has picked up.
create index persona_story_details_story_idx on deadair.persona_story_details (story_id) where state = 'active';

-- migrate:down

drop table if exists deadair.persona_story_details;
drop table if exists deadair.persona_stories;
