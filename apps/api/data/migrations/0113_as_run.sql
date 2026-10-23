-- migrate:up

-- What actually went out, in order, with times the operator can trust.
--
-- The running order (`station_lineup`) says what was PLANNED and is a live window rather than a
-- record: items leave it once they have aired. `play_history` holds records only, because it is the
-- memory the repeat window and the artist cooldown steer off, and a break or an ident in it would put
-- "Station ident" in the song key space. The activity feed carries the station's moments and not a
-- row per item. None of the three answers "what was on air at 21:14 last Tuesday, and for how long".
--
-- One row per item, written on the rundown's own `onAired` edge, which is the player saying the item
-- STARTED rather than the station handing it over a few records early. `aired_at` is that moment.
-- `ended_at` is stamped when the next item airs or the station is stood down, and stays null while an
-- item is on air or when the station stopped without a stand-down (a crash), since nothing then saw
-- it end. Silences and off-air stretches are NOT copied here: the transport already writes `gap`,
-- `air.on` and `air.off` to `station_events`, and the read joins them rather than holding a second
-- copy that could disagree.
--
-- The title and the credit are copied, unlike the catalog's cover, because they are what a listener
-- heard: a title corrected next week must not rewrite last night's log.
create table deadair.as_run (
    created_at timestamptz not null default now(),
    id uuid not null default gen_random_uuid() primary key,
    station_key text not null default 'main',
    broadcast_id uuid,
    -- The running order's own id for the item, which is what rode through the player.
    item_id text not null,
    kind text not null constraint as_run_kind_check check (kind in ('record', 'break', 'programme')),
    -- The catalog track for a record, and the segment for a break or a programme. Set null rather
    -- than cascade, because the catalog or the segment sweep forgetting a row does not unair it.
    track_id uuid references deadair.tracks (id) on delete set null,
    segment_id uuid references deadair.segments (id) on delete set null,
    title text not null,
    artists text not null default '',
    -- What put it in the running order, as `play_history.source` spells it. Null for a break.
    source text,
    aired_at timestamptz not null,
    ended_at timestamptz,
    -- How many items already handed to the player it moved past to reach this one, which never
    -- aired. The same count the `order.caughtUp` event carries, kept on the row it happened before.
    passed_over integer not null default 0 constraint as_run_passed_over_check check (passed_over >= 0),
    constraint as_run_ended_check check (ended_at is null or ended_at >= aired_at)
);

-- The read is newest first per station, keyed on the same pair the cursor uses.
create index as_run_aired_at_idx on deadair.as_run (station_key, aired_at desc, id desc);
-- The close finds the one open row.
create index as_run_open_idx on deadair.as_run (station_key) where ended_at is null;

-- migrate:down

drop table deadair.as_run;
