-- migrate:up

-- What KIND of thing a character is carrying, because "a story" turned out to be three things.
--
-- `deadair.persona_stories` was built for the ANECDOTE: a self-contained few sentences about a night
-- that happened, told whole or not at all, and it is still the shape of most of what a character
-- holds. Two others want the same table and behave differently once they are in a prompt:
--
--   * an ARC is told a part at a time and gets somewhere. It has `persona_story_beats` under it and
--     is finished when its last one has aired.
--   * a BIT is a running joke with no end and no order — the thing a presenter returns to and
--     escalates. It has no beats; what it has is its own history, which is what the ledger holds.
--
-- A column rather than three tables, because everything they share is everything the table already
-- does: the `suggested`/`rejected` states, the partial unique index on the handle, the rotation, the
-- details, the cascade. What differs is only how one is read INTO a break, which is prompt-side.
--
-- `not null` with a default, on `personas.kind`'s argument: a nullable version would make "anecdote"
-- and "nobody said" the same value right up until something had to tell them apart.
alter table deadair.persona_stories add column kind text not null default 'anecdote'
    constraint persona_stories_kind_check check (kind in ('anecdote', 'arc', 'bit'));

-- One part of an arc, in the order it is to be told.
--
-- **A beat is a SCRIPT, not a summary**, exactly as `persona_stories.story` is and for the same
-- reason: `StoryBreakWriter` speaks it as it stands, which is what makes the story break's floor
-- unable to fail. A column of stage directions would need a model to turn it into words, and a
-- station with no model would then have arcs it could never tell.
--
-- Shaped after `persona_story_details` in every other respect. The difference between the two is
-- worth stating, because the obvious move is to reuse that table: a DETAIL is something the story
-- picked up, it has no position, and every active one is shown at once. A BEAT is one telling's
-- worth of material and exactly one is shown, which is the whole of what makes an arc an arc.
create table deadair.persona_story_beats (
    id uuid not null default gen_random_uuid() primary key,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now() check (updated_at >= created_at),
    -- CASCADE, as a detail's is: a beat whose arc is gone is a fragment nothing can place.
    story_id uuid not null references deadair.persona_stories (id) on delete cascade,
    -- Where it comes in the telling. Gaps are legal and expected: an operator inserting a part
    -- between two others should not have to renumber, and nothing here reads the number for
    -- anything but the order.
    ordinal integer not null check (ordinal >= 0),
    beat text not null check (length(btrim(beat)) > 0),
    state text not null constraint persona_story_beats_state_check check (state in ('active', 'suggested', 'rejected')),
    origin text not null constraint persona_story_beats_origin_check check (origin in ('operator', 'model')),
    -- Where a proposal came from. See `persona_stories.source`: prose for the operator reading it,
    -- and not evidence. A story is fiction about a character and so is a part of one.
    source text
);

-- One beat per position per arc. Partial for the reason every other index here is: a rejected
-- proposal must not stand between an operator and their own version of the same part.
create unique index persona_story_beats_ordinal_idx on deadair.persona_story_beats (story_id, ordinal) where state <> 'rejected';

-- And one per wording, so the nightly pass cannot propose the same part twice under two numbers.
create unique index persona_story_beats_beat_idx on deadair.persona_story_beats (story_id, lower(btrim(beat))) where state <> 'rejected';

-- The read a break makes: this arc's tellable parts, in order.
create index persona_story_beats_story_idx on deadair.persona_story_beats (story_id, ordinal) where state = 'active';

select deadair.add_updated_at_trigger('deadair.persona_story_beats');

-- WHICH part a telling told, so the next one is owed rather than guessed at.
--
-- Null for an anecdote and for a bit, which have no parts, and for an arc telling recorded before
-- this column existed. CASCADE with the beat for `story_id`'s reason one level up: a telling of a
-- part that is gone cannot say what it told.
alter table deadair.persona_tellings add column beat_id uuid references deadair.persona_story_beats (id) on delete cascade;

-- The read that decides what an arc owes next: has this part aired yet.
create index persona_tellings_beat_idx on deadair.persona_tellings (beat_id) where beat_id is not null;

-- migrate:down

drop index if exists deadair.persona_tellings_beat_idx;
alter table deadair.persona_tellings drop column if exists beat_id;
drop table if exists deadair.persona_story_beats;
alter table deadair.persona_stories drop column if exists kind;
