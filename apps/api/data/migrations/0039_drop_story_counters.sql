-- migrate:up

-- The two stamps `deadair.persona_tellings` replaced, now that nothing reads or writes them.
--
-- `last_told_at` and `times_told` were the whole of what the station knew about a story's history:
-- when it last went out, and how often. That answered "whose turn is it" and could not answer any of
-- the three things asked of it since — which part of a story went out, what was actually said, and
-- what an operator is undoing when they roll a character back. Migration 0034 added the ledger those
-- read instead, and both columns have been derived from it since.
--
-- Dropped rather than left in place, because a column nothing writes is a column somebody will
-- eventually read: `persona_stories.last_told_at` was still being counted by the audition smoke as
-- its proof that a run spends nothing, which by then was a check that could not fail. That is the
-- failure mode of leaving one behind, and it is quiet.
--
-- The index goes with them. It ordered the rotation by `last_told_at`, and the rotation is now a
-- correlated subquery over the ledger — `persona_tellings_story_idx` is what serves it.
drop index if exists deadair.persona_stories_active_idx;

alter table deadair.persona_stories drop column if exists last_told_at;
alter table deadair.persona_stories drop column if exists times_told;

-- migrate:down

alter table deadair.persona_stories add column last_told_at timestamptz;
alter table deadair.persona_stories add column times_told integer not null default 0 check (times_told >= 0);

-- Rebuilt from the ledger rather than restored empty, so a station that rolls back does not read as
-- one whose characters have never said anything.
update deadair.persona_stories s
set last_told_at = (select max(t.created_at) from deadair.persona_tellings t where t.story_id = s.id),
    times_told = (select count(*) from deadair.persona_tellings t where t.story_id = s.id and t.told);

create index persona_stories_active_idx on deadair.persona_stories (station_key, persona_key, last_told_at nulls first) where state = 'active';
