-- migrate:up

-- What a break can be ABOUT: the operator's own vocabulary, per sort of break.
--
-- News categories are the first of these — US news, world news, the local one only this operator
-- can name, technology, pop culture — and they are deliberately NOT built as a news feature.
-- [station-moment](https://github.com/robert-dean/deadair/discussions/38) wants weather next, and weather wants exactly this shape with a
-- different payload: a named list of things an operator manages, that the format clock can point a
-- band at (`news` / Technology, `weather` / Atlanta) and a writer can be handed. Building it twice
-- is how the second one ends up subtly different from the first.
--
-- Its own file because it is its own subject, and it is a file that also has to come AFTER
-- `0017_schedule.sql`: `clock_bands.topic_id` references this table, which is the same ordering
-- `station_lineup.persona_id` had to respect when personas arrived in 0012 and the column followed
-- in 0013.
--
-- A table rather than settings, on `0012_personas.sql`'s argument: a `ConfigField` describes one row
-- of a form, and this is a list an operator adds to, edits and reorders. The words have to be the
-- operator's, so the words cannot be ours — the station seeds a vocabulary and every entry in it can
-- be rewritten or deleted.
create table deadair.topics (
    id uuid not null default gen_random_uuid() primary key,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now() check (updated_at >= created_at),
    -- Whose vocabulary this is. Present for the reason it is on every other station-owned table: the
    -- second station is a row rather than a migration.
    station_key text not null default 'main',
    -- Which sort of break this is a subject for, as `segments.kind` spells it.
    --
    -- Free text like the kind on a clock band and on a segment, and NOT a foreign key to anything:
    -- what kinds exist is decided by what can write one, which is a registry in the app rather than
    -- a table. A row naming a kind nothing serves is inert, which is the same outcome as a band
    -- naming a break nothing can produce.
    kind text not null,
    -- The slug anything else refers to this by, unique within its kind. What a log line names and
    -- what a seeded topic is recognised by, so seeding twice is impossible rather than unlikely.
    key text not null,
    -- What a break calls this out loud: `Technology`, `Atlanta`. Written into a script, so it is the
    -- operator's phrasing rather than a prettified key.
    label text not null,
    -- How this kind decides whether something belongs to this topic.
    --
    -- **Deliberately shapeless**, exactly as `break_requests.context` is and for the same reason:
    -- the code for a kind knows what its own kind's config looks like, reads what it expects and
    -- ignores the rest, and nothing generic ever reads it — so a shared schema would be a shape
    -- nobody is in a position to define. For `news` it is the feeds, the publishers' own labels and
    -- the words that mean this category; for weather it will be a place. The JSON-safe rule applies:
    -- no dates but ISO-8601 strings, durations as integer milliseconds.
    config jsonb not null default '{}'::jsonb,
    -- The operator's own order, for a console drawing a list. No meaning beyond that: unlike a clock
    -- band, two topics never contest anything.
    position integer not null default 0,

    -- Two topics of one kind under one key means one of them can never be asked for, which is the
    -- same failure a duplicate persona key would be. Refused rather than resolved.
    constraint topics_key_unique unique (station_key, kind, key)
);

select deadair.add_updated_at_trigger('deadair.topics');

-- The console's read and the writers': this station's vocabulary for one kind, in order.
create index topics_kind_idx on deadair.topics (station_key, kind, position, id);

-- What this band is ABOUT, or null for one that covers whatever it finds.
--
-- Here rather than in `0017_schedule.sql` beside the rest of the band because the table it points
-- at is in this file, which is the same ordering `station_lineup.persona_id` had to respect in 0013.
--
-- **`cascade` rather than `set null`**, deliberately and against the habit of every other reference
-- in this schema. A band that quietly lost its subject would go on claiming its boundary and read a
-- GENERAL bulletin under a category's name, which is the one failure this whole feature exists to
-- prevent: silence is a state an operator can see and a wrong bulletin is not. Losing the band costs
-- the slot, which is the same answer a category that matches nothing already gives.
alter table deadair.clock_bands add column topic_id uuid references deadair.topics (id) on delete cascade;

-- Which bands ask for a subject, for the console's "and these go too" before a delete.
create index clock_bands_topic_idx on deadair.clock_bands (topic_id) where topic_id is not null;

-- migrate:down

alter table deadair.clock_bands drop column topic_id;

drop table if exists deadair.topics;
