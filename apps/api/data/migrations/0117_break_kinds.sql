-- migrate:up

-- A kind of break the OPERATOR writes, rather than one the station ships: a two-line poem about the
-- moment, a note on what taping music off the radio was like. Ideas #24.
--
-- A kind is already free text everywhere it is stored (`segments.kind`, `clock_bands.kind`), so a
-- band can name one of these and the segment it plants can carry it with no schema change. What did
-- not exist is anything to WRITE one: the station's writers are classes, each with its kind in code.
-- This row is what an operator-written kind's writer reads instead.
--
-- Prose only, deliberately. A kind that fetched live data would be code, and code here is a plugin
-- with everything `packages/plugin-sdk/CLAUDE.md` § "Trust and egress" says about one. A row is
-- words an operator wrote and nothing else.
--
-- A table rather than a directory of files, on `0018_topics.sql`'s argument: a list an operator adds
-- to, edits and switches on, through the console that already edits the clock and the topics. A file
-- that moves between stations is an export of a row, not where the row lives.
create table deadair.break_kinds (
    id uuid not null default gen_random_uuid() primary key,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now() check (updated_at >= created_at),
    -- Whose kind this is. Present for the reason it is on every other station-owned table.
    station_key text not null default 'main',
    -- The kind itself, exactly as `segments.kind` and `clock_bands.kind` spell it.
    --
    -- A slug, and fixed once written: a band names it and every segment it planted carries it, so
    -- renaming one would leave the bands asking for a kind nothing writes and the history naming one
    -- that no longer exists. The app refuses a key the station's own writers already claim, and the
    -- registry ignores such a claim anyway (`BreakKindClaimant`), so no row can take over a talk break.
    key text not null check (key ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
    -- What the console calls it. Never read out.
    name text not null check (length(trim(name)) > 0),
    -- What this kind of break is FOR, in the operator's prose: what to cover, and when to say
    -- nothing. The writer hands it to the model as the shape's `job`, so it is written as an
    -- instruction to a presenter rather than as a description of a feature.
    brief text not null check (length(trim(brief)) > 0),
    -- Anything this kind owes on top of the rules every break owes, one per entry. Appended to the
    -- shared list and never in place of it: no row can switch a refusal off.
    rules text[] not null default '{}',
    -- What the writer is shown, which is the data half of `BreakPromptShape`, field for field, rather
    -- than a vocabulary beside it that would need mapping onto it.
    --
    -- The record that just finished. On by default, because most breaks follow a record.
    shows_previous boolean not null default true,
    -- The rest of this broadcast's records, as something to refer back to. Off by default, as it is
    -- on every shape but the talk break.
    shows_played boolean not null default false,
    -- The notes the station holds about the records shown. On by default, as on the talk break.
    shows_facts boolean not null default true,
    -- The presenter's own notebook. On by default, as on the talk break.
    shows_notebook boolean not null default true,
    -- Whether the station writes this kind at all. **Off when written**, and switched on by hand: an
    -- operator reads a kind back before it airs, and an imported kind arrives in exactly the state a
    -- new one does, so the same switch guards both.
    enabled boolean not null default false,
    -- The operator's own order, for the console's list. No meaning beyond that.
    position integer not null default 0,

    constraint break_kinds_key_unique unique (station_key, key)
);

select deadair.add_updated_at_trigger('deadair.break_kinds');

-- The console's list, and the catalog's read of what is switched on.
create index break_kinds_station_idx on deadair.break_kinds (station_key, position, id);

-- migrate:down

drop table if exists deadair.break_kinds;
