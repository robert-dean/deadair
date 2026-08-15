-- migrate:up

-- Who the station is when it opens its mouth.
--
-- This was two free-text settings — `llm.breakPersona` and `llm.setPersona` — handed to a model and
-- reaching nothing else. A table rather than more settings for the reason moods are one in
-- `docs/todo/station-moment.md`: a `ConfigField` describes one row of a form, and this is a list an
-- operator adds to, edits and switches between. The words have to be the operator's, so the words
-- cannot be ours.
--
-- **A persona is wider than a prompt, and that is the whole point.** `templates` is the station's
-- deterministic floor written in this character, so a model that declined — the ordinary case, by
-- design — costs a better sentence rather than the character. `voice` is which of the speech
-- plugin's voices says it. `music` is what it programmes towards. A persona that only reached the
-- model would vanish at exactly the moments the station needs it most.
create table deadair.personas (
    id uuid not null default gen_random_uuid() primary key,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now() check (updated_at >= created_at),
    -- Whose personas these are. Present for the same reason it is on every other station-owned
    -- table: the second station is a row rather than a migration.
    station_key text not null default 'main',
    -- A stable slug, and what a seeded persona is recognised by. Unique per station so seeding twice
    -- is impossible rather than merely unlikely.
    key text not null,
    label text not null,
    -- Completes "You are …". WHO they are; the sheet columns below carry HOW they talk.
    style text not null,
    -- The name this character goes by on air, overriding `station.djName` while it is active. Null
    -- for a persona that is a manner rather than a character.
    dj_name text,
    -- The opaque station voice id a speech plugin maps, or null for that plugin's default. Not a
    -- reference to anything: which voices exist is the engine's business and the host never
    -- interprets the id. See `packages/plugin-sdk/src/capabilities/speech.ts`.
    voice text,
    -- The character sheet's list fields, as jsonb arrays of strings. jsonb rather than text[]
    -- because the whole sheet crosses the wire and is edited as JSON by the console, and a Postgres
    -- array would be the one shape needing a translation at both ends.
    --
    -- `diction` is the dialect that governs EVERY sentence and `quirks` is what the character talks
    -- about; the split is load-bearing and `persona.sheet.ts` explains why. `diction_markers` are
    -- the words whose presence proves the dialect survived, which is what makes a model's answer
    -- checkable rather than merely hoped at.
    diction jsonb not null default '[]'::jsonb,
    diction_markers jsonb not null default '[]'::jsonb,
    quirks jsonb not null default '[]'::jsonb,
    catchphrases jsonb not null default '[]'::jsonb,
    avoid jsonb not null default '[]'::jsonb,
    samples jsonb not null default '[]'::jsonb,
    background text,
    -- This character's own break phrasings, one per line, in the syntax of
    -- `rotation.breakTemplates`. Empty means the station's global ones.
    templates text,
    -- What this persona plays, for the model that chooses records. A description, which is why a
    -- running order's own `brief` beats it: the persona is who the station is and the brief is
    -- somebody deciding tonight.
    music text,
    -- Whether this is the one on air. At most one per station, enforced below rather than by
    -- convention, because two active personas is a state nothing downstream could resolve and every
    -- reader would resolve differently.
    active boolean not null default false,

    constraint personas_key_unique unique (station_key, key)
);

create unique index personas_one_active_idx on deadair.personas (station_key) where active;

select deadair.add_updated_at_trigger('deadair.personas');

-- Which persona a break was written and spoken as.
--
-- Denormalised in the sense that matters: the words and the voice are already ON the segment row, so
-- this answers "who was on air when it was written" rather than being read to produce anything. That
-- is why it is `set null` rather than cascade — a break aired in a character an operator has since
-- deleted still aired, and losing the segment would lose what was actually said.
alter table deadair.segments add column persona_id uuid references deadair.personas (id) on delete set null;

-- Retiring a setting has to take its ROW with it. Nothing reads these two keys any more and nothing
-- declares them, so `GET /settings` never renders them and `PUT /settings` refuses them — which
-- leaves an operator's own words sitting in a table that has no way to show them or delete them.
-- A setting is only really retired once the row is gone.
delete from deadair.settings where key in ('llm.breakPersona', 'llm.setPersona');

-- migrate:down

alter table deadair.segments drop column persona_id;

drop table deadair.personas;
