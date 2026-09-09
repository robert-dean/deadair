-- migrate:up

-- A character heard over an hour of real records before it goes on air.
--
-- `POST /personas/{id}/rehearse` writes ONE break against a fixed invented pair, which is a
-- measurement of a sheet edit and nothing more: no facts, no history, the same two records every
-- time so two readings compare. What it cannot answer is whether a sheet holds up over a playlist —
-- whether the host repeats itself by the fourth break, whether the model declines every other
-- transition once real facts are in front of it, what the floor sounds like when it covers. That was
-- only knowable by putting the character on air and waiting an evening, which is what
-- `scripts/break.declines.ts` measures after the fact.
--
-- An audition is one persona, one playlist, one talk break per transition, written one at a time by
-- a job per transition so the station's one model slot is free between them and a restart resumes
-- from the row. The row IS the checkpoint, on `productions`' argument: `cursor` says which transition
-- is next, and a job that finds the cursor elsewhere has nothing to do.
--
-- ## It cannot air, and holds nothing that could put it on air
--
-- No row here is a `segments` row, nothing writes `script_history`, and nothing posts a
-- `break_requests` row: an audition break is a fact in this table and nowhere else, so "cannot be
-- planted" is a property of the schema rather than a rule to remember. That is the rehearsal's
-- argument, one table over. It is also why the notebook, the stories and the facts are READ by an
-- audition and never stamped: every `last_used_at` in this schema is a rotation the next real break
-- depends on, and an operator pressing a button must not hand the station its second-best lines.
create table deadair.persona_auditions (
    id uuid not null default gen_random_uuid() primary key,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now() check (updated_at >= created_at),
    -- Whose audition this is, as on every other station-owned table.
    station_key text not null default 'main',
    -- CASCADE, against the habit of every aired record here (`segments.persona_id` and
    -- `productions.persona_id` are `set null`): those are records of what went out, and an audition
    -- of a character nobody has any more is noise rather than history.
    persona_id uuid not null references deadair.personas (id) on delete cascade,
    -- The persona's own key beside the id, as `script_history.persona_key` holds it: the stable
    -- name a console groups by and a report counts by.
    persona_key text not null check (length(btrim(persona_key)) > 0),
    -- Which playlist, as the plugin and its own id, and what it was called when the run started.
    -- The name is a snapshot for the console rather than a reference: a playlist renamed or deleted
    -- at the provider must not make a finished audition unreadable.
    source_plugin_id text not null check (length(btrim(source_plugin_id)) > 0),
    source_playlist_id text not null check (length(btrim(source_playlist_id)) > 0),
    source_name text,
    -- The records, in order, resolved at the moment the operator asked and never re-read: title,
    -- lead artist, and whatever the catalog knew (`trackId`, year, album, length). Stored rather
    -- than re-fetched because the run must not depend on the provider still answering, and because
    -- two transitions of one audition must be written against the same list.
    records jsonb not null,
    -- How many breaks this run writes: one per transition, so one fewer than the records.
    transitions integer not null check (transitions >= 1),
    -- The next transition to write, from 0. What a job claims against: a job for ordinal 3 finds a
    -- cursor at 4 and does nothing, which is what makes a duplicate delivery free.
    cursor integer not null default 0 check (cursor >= 0 and cursor <= transitions),
    -- How far along it is.
    --
    --   queued     asked for; no job has run
    --   running    at least one transition has been claimed
    --   done       every transition has a break recorded
    --   failed     a job threw, and `error` says what happened
    --   cancelled  somebody stopped it, and no job may spend anything else on it
    state text not null default 'queued' constraint persona_auditions_state_check check (state in ('queued', 'running', 'done', 'failed', 'cancelled')),
    error text,
    -- When it was stopped, and the terminal fact every job re-reads through its claim. A queue
    -- cannot cancel: everything already sent will arrive, so the stop is a fact on the row.
    cancelled_at timestamptz,
    finished_at timestamptz,
    -- Who asked for it.
    actor_id uuid references deadair.actors (id) on delete set null
);
select deadair.add_updated_at_trigger('deadair.persona_auditions');

-- The console's read: one character's auditions, newest first.
create index persona_auditions_persona_idx on deadair.persona_auditions (station_key, persona_id, created_at desc);

-- One transition of an audition, and everything the writers said about it.
--
-- One row per break rather than an array on the run, so a run of forty transitions is forty small
-- rows the console can page and a job can append to without rewriting the run. `attempts` is every
-- writer that was asked and not only the one that won, on `BreakWriterRegistry`'s argument: a model
-- that declined and a floor that covered for it are two facts, and the second alone reads as a
-- station that never had a model.
create table deadair.persona_audition_breaks (
    id uuid not null default gen_random_uuid() primary key,
    created_at timestamptz not null default now(),
    -- CASCADE: a break whose audition is gone is a script nobody can place.
    audition_id uuid not null references deadair.persona_auditions (id) on delete cascade,
    -- Which transition, from 0. Matches the `cursor` it advanced.
    ordinal integer not null check (ordinal >= 0),
    -- The two records exactly as the writers were shown them, facts included, so what the host said
    -- can be read against what it was told.
    previous jsonb not null,
    next jsonb not null,
    -- `[{ writer, outcome, durationMs, script?, reason? }]`, in the order the writers were asked.
    attempts jsonb not null,
    -- The words a listener would have heard, from whichever writer answered first. Null when every
    -- writer had nothing, which on air is a break the station skips.
    script text,
    writer text,
    -- Why there are no words, when there are none.
    reason text
);

-- One break per transition per audition, and the read every job and the console make: in order.
create unique index persona_audition_breaks_ordinal_idx on deadair.persona_audition_breaks (audition_id, ordinal);

-- migrate:down

drop table if exists deadair.persona_audition_breaks;
drop table if exists deadair.persona_auditions;
