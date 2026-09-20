-- migrate:up

-- Every time one of a character's stories was carried into something it said.
--
-- `deadair.persona_stories` holds WHAT a character has to tell and two columns saying how the
-- rotation stands: `last_told_at` and `times_told`. Both are stamps that overwrite themselves, which
-- is enough for "whose turn is it" and is not enough for anything else asked of them since:
--
--   * **A story that ADVANCES needs a place in it**, not a count of how often it has come round. A
--     counter cannot say which part went out, so nothing can owe the next one.
--   * **A callback needs what was actually SAID.** `script_history` holds that and is swept nightly
--     at 04:23 (`render.prune_script_history`), so anything meant to outlive the sweep is
--     denormalised here, exactly as `persona_notes.source_quote` is and for the same reason.
--   * **An operator undoing what the station accrued needs something to undo.** A stamp that was
--     overwritten has no earlier value to go back to. Rows have.
--
-- So this table is the ledger those three read, and `persona_stories.last_told_at` / `times_told`
-- become derived from it (migration 0038 drops them). Append-only for `script_history`'s reason: a
-- row is a fact about a moment, and an `updated_at` here could only ever repeat `created_at` while
-- inviting somebody to make it lie.
create table deadair.persona_tellings (
    id uuid not null default gen_random_uuid() primary key,
    created_at timestamptz not null default now(),
    -- Whose telling this was, as on every other station-owned table.
    station_key text not null default 'main',
    -- WHICH character, as the persona's own key and with no foreign key, exactly as
    -- `persona_stories.persona_key` and `script_history.persona_key` hold it. Denormalised off the
    -- story deliberately: the timeline this feeds is read per CHARACTER, and a rollback has to be
    -- able to find a character's rows without a join to a table it is deleting from.
    persona_key text not null check (length(btrim(persona_key)) > 0),
    -- CASCADE, as `persona_story_details.story_id` is: a telling of a story that is gone is not a
    -- smaller telling, it is a row nothing can place.
    story_id uuid not null references deadair.persona_stories (id) on delete cascade,
    -- The break that carried it. `on delete set null` rather than cascade, against the line above,
    -- because the two answer different questions: a telling outlives its segment the way
    -- `script_history` does, and the ledger's whole job is to remember after the running order has
    -- moved on. Null for a telling whose segment has since been swept.
    segment_id uuid references deadair.segments (id) on delete set null,
    -- What wrote it. `backfill` is this migration's own rows, which carry no script and no segment.
    source text not null constraint persona_tellings_source_check check (source in ('break', 'production', 'backfill')),
    -- Whether the story was HANDED to the writer as something it may use, or as the thing the break
    -- is for. `BreakPromptShape.stories`' two values, recorded so the timeline can say which.
    mode text not null constraint persona_tellings_mode_check check (mode in ('offered', 'told')),
    -- Whether it actually went out in the words that were written, as the WRITER read them back.
    --
    -- Never the model's own word for it: `weather.figures.ts` records why a model asked what it just
    -- did is a check that approves its own work. An `offered` story may be ignored, and a break that
    -- fell to the deterministic floor said nothing of it at all — so the rotation moves on a CARRY
    -- (any row) while a story's progress moves only on a TELLING (`told`), and the two facts have to
    -- be separable or a story the model keeps passing over blocks the shelf forever.
    told boolean not null default false,
    -- The words that carried it, capped. Denormalised off `script_history` because that table is
    -- swept and this is what a later break is shown so it can refer back to what was actually said.
    said text,
    -- When a listener could first have heard it, stamped on the aired edge. Null means written but
    -- not yet aired — or never aired, because the break was dropped before its slot.
    --
    -- The distinction is load-bearing for an arc: a beat is owed until it has AIRED, or a retracted
    -- break silently costs a listener episode two.
    aired_at timestamptz,
    -- A telling that went out in a break has to carry what it said, or the callback it exists to feed
    -- has nothing to show. Productions and the backfill are excused: the first stores its script
    -- elsewhere, the second is reconstructing rows whose words are long gone.
    constraint persona_tellings_said_check check (not told or source <> 'break' or said is not null)
);

-- One row per segment, which is what makes a rewrite a REPLACEMENT rather than a second telling.
-- Segments are reopened and rewritten constantly (`segment.repository.ts` counted 234 reopens in
-- seven days), and every rewrite of one break is still one thing the listener hears.
create unique index persona_tellings_segment_idx on deadair.persona_tellings (segment_id) where segment_id is not null;

-- The read the rotation and an arc both make: this story's tellings, newest first.
create index persona_tellings_story_idx on deadair.persona_tellings (story_id, created_at desc);

-- The read the console's timeline makes, and the one a rollback deletes over.
create index persona_tellings_timeline_idx on deadair.persona_tellings (station_key, persona_key, created_at desc);

-- What the two columns being replaced already know, so the rotation does not reset the day this
-- lands. One row per story that has ever gone out, at the moment it last did.
--
-- `times_told` is deliberately NOT reproduced as N rows: the count is unreliable in the other
-- direction anyway (it counted selections, not tellings), the prompt only ever tests whether it is
-- above zero, and inventing tellings with no date would put fiction in a ledger whose whole value is
-- that it records what happened.
insert into deadair.persona_tellings (station_key, persona_key, story_id, created_at, source, mode, told, aired_at)
select station_key, persona_key, id, last_told_at, 'backfill', 'offered', true, last_told_at
from deadair.persona_stories
where last_told_at is not null;

-- migrate:down

drop table if exists deadair.persona_tellings;
