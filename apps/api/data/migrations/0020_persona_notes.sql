-- migrate:up

-- What a character has accumulated, which its sheet cannot hold.
--
-- A persona is a sheet somebody wrote, and every break is written against that sheet plus the last
-- few scripts of this broadcast. So a host could never refer back to something it said last week,
-- could never stay consistent about an opinion it had already put on air, and could not develop at
-- all. This is the store that answers the first two and makes the third expressible.
--
-- A TABLE rather than a `notes` jsonb on `deadair.personas`, on the argument that already moved the
-- format clock out of a settings box and the lexicon out of `render.pronunciations`: this is a list
-- an operator and the station both append to, whose entries reference something, and whose entries
-- can be turned down in a way that has to outlive the pass that proposed them.
create table deadair.persona_notes (
    id uuid not null default gen_random_uuid() primary key,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now() check (updated_at >= created_at),
    -- Whose notebook this is, as on every other station-owned table.
    station_key text not null default 'main',
    -- WHICH character, as the persona's own key and with no foreign key, exactly as
    -- `script_history.persona_key` holds it. The key is the stable name — `personas_key_unique`
    -- makes it one, and a persona deleted and written back by `restore` keeps it where the id does
    -- not — and a note is about a character rather than about a row.
    persona_key text not null check (length(btrim(persona_key)) > 0),
    -- The two kinds, and the whole design turns on the difference between them.
    --
    -- `said` is something this character actually put on air. Its evidence is the station's own
    -- script, so it is a RECORD and goes active unattended: nothing was inferred.
    --
    -- `trait` is an inference about who the character is becoming, which is a different claim
    -- entirely. No quote can entail it, so nothing can verify it and the operator is the check —
    -- which is why one arrives active and the other arrives `suggested`. A `trait` note read into a
    -- prompt IS a sheet edit; it just is not one its author wrote, and a station that made those
    -- unattended would drift out of the character an operator can still see on the page.
    kind text not null constraint persona_notes_kind_check check (kind in ('said', 'trait')),
    -- One sentence. What actually reaches the prompt, and the reason the caps beside
    -- `PERSONA_SHEET_LIMITS` exist: every line of accumulated flavour is a line of "never name a
    -- record you were not given" further from the end of the system turn.
    note text not null check (length(btrim(note)) > 0),
    -- `active` is carried into breaks. `suggested` is proposed and says nothing yet. `rejected` is
    -- an operator having looked at a proposal and turned it down, kept rather than deleted for
    -- `pronunciations`' reason: the pass re-reads the same scripts and would propose it forever.
    state text not null constraint persona_notes_state_check check (state in ('active', 'suggested', 'rejected')),
    -- Who says so. `model` is the distil pass reading this character's own history back.
    origin text not null constraint persona_notes_origin_check check (origin in ('operator', 'model')),
    -- The evidence. `on delete set null` because `render.prune_script_history` sweeps that table
    -- nightly and a note legitimately outlives the attempt it was drawn from — which is why the
    -- QUOTE is denormalised beside the reference rather than reachable through it. Mirrors `facts`:
    -- a claim the station will say out loud, with no source, must not be expressible.
    source_script_id uuid references deadair.script_history (id) on delete set null,
    source_quote text,
    constraint persona_notes_evidence_check check (origin = 'operator' or source_quote is not null),
    -- The cooldown, read the way `facts.last_used_at` is and stamped by a separate call, so a reader
    -- that is not putting anything on air — a rehearsal — does not spend them.
    last_used_at timestamptz
);

-- One note per character per wording. Partial for `pronunciations_written_idx`'s exact reason: a
-- rejected proposal must not stand between an operator and their own note saying the same thing.
-- This is also what stops the distil pass writing the same note every night.
create unique index persona_notes_note_idx on deadair.persona_notes (station_key, persona_key, lower(btrim(note))) where state <> 'rejected';

-- The read every break makes: one character's active notes, oldest-used first.
create index persona_notes_active_idx on deadair.persona_notes (station_key, persona_key, last_used_at nulls first) where state = 'active';

-- How far the distil pass has read, per character.
--
-- It exists for `fact_extractions`' reason — a pass that yielded nothing must be distinguishable
-- from one that never ran — but it is a WATERMARK rather than a row per item, and that difference is
-- the shape of the queue rather than a shortcut. Documents arrive individually and are read in no
-- particular order, so each needs its own mark; scripts are a time-ordered stream, so one timestamp
-- says everything about what has been seen.
--
-- Its own table rather than a column on `deadair.personas`, because `PersonasService.update`
-- rewrites that row from a console form and would silently roll the watermark back to whatever the
-- form last loaded.
create table deadair.persona_note_passes (
    station_key text not null default 'main',
    persona_key text not null,
    -- Everything written at or before this instant has been read. Null means never read, which is
    -- how a character that has just been written gets its whole history on the first pass.
    read_through timestamptz,
    ran_at timestamptz not null default now(),
    primary key (station_key, persona_key)
);

-- migrate:down

drop table if exists deadair.persona_note_passes;
drop table if exists deadair.persona_notes;
