-- migrate:up

-- The records an operator cut short with Skip.
--
-- `play_history` is written when a record STARTS and never updated, so a record cut after ten seconds
-- and one heard to its last note were the same row, and nothing the station did afterwards could tell
-- them apart. An operator pressing Skip is the clearest opinion about a record the station ever gets
-- short of a dislike, and it was being thrown away. This keeps it, as a lean and never a veto: the
-- draw weighs a skipped record down for a while and lets it recover (`skip.lean.ts`).
--
-- Only the operator's own Skip writes here (`PlayoutService.skip`, which the console, the MCP tool and
-- the chat command all reach). A dislike's cut, a changeover's overrun cut and a skip-to are the station
-- obeying a rule or the operator navigating, and none of them is a verdict on the record on air.
--
-- Numbered 0083 because 0082 is taken on another branch; dbmate applies any version it has not
-- recorded, in order, so the two can land either way round.
create table deadair.track_skips (
    created_at timestamptz not null default now(),
    id uuid not null default gen_random_uuid() primary key,
    -- Which station, as `play_history` keys it.
    station_key text not null default 'main',
    -- The catalog row, when there is one. Set null on delete, as the history does: the skip happened.
    track_id uuid references deadair.tracks (id) on delete set null,
    -- The identities the draw reads, off the same lead artist `play_history` is written with.
    song_key text not null,
    artist_key text not null,
    -- How far into the record the cut came, when the player had said when it started.
    after_ms integer constraint track_skips_after_ms_check check (after_ms is null or after_ms >= 0),
    -- Who pressed it. Null for a caller with no user behind it.
    actor_id uuid references deadair.actors (id) on delete set null,
    skipped_at timestamptz not null default now()
);

create index track_skips_skipped_at_idx on deadair.track_skips (station_key, skipped_at desc);

-- migrate:down

drop table deadair.track_skips;
