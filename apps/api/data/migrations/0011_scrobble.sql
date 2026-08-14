-- migrate:up

-- What the station has played and has not yet told anybody about.
--
-- The only outbound queue in the tree. Everything else a plugin does is a read, so a failure costs
-- an answer and the next pass tries again; this is the station publishing to an account somebody
-- holds, where a failure that is not retried is a listen that never happened as far as their history
-- is concerned. Hence a table rather than a fire-and-forget call: a restart, a redeploy or an hour
-- of somebody else's downtime must not lose plays.
--
-- **One row per play per DESTINATION**, which is why `plugin_id` is part of the row rather than a
-- list on it. Two scrobblers fail independently and a shared row would make one service's outage a
-- retry of both, re-sending to the one that already took them.
--
-- Nothing reads this to make a decision about the broadcast. It is written at the moment a record
-- goes to air and drained by a cron, and if the whole table were lost the station would sound
-- exactly the same.
create table deadair.scrobble_queue (
    created_at timestamptz not null default now(),
    id uuid not null default gen_random_uuid() primary key,
    station_key text not null default 'main',
    -- Which broadcast it aired in. Nullable for the reason `station_events` gives, though unlike
    -- there it should almost always be set: something aired, so a broadcast was on.
    broadcast_id uuid,
    -- Which destination this row is for. Deliberately NOT a foreign key: plugins are rows in
    -- `plugin_configs` keyed by a text id, and a plugin uninstalled with plays outstanding should
    -- leave them here to be swept rather than take them with it — the operator may reinstall it.
    plugin_id text not null,
    -- The play itself, as the SDK's `ScrobblePlay`: title, artist, album, duration, mbid. Stored
    -- whole rather than as columns because the host does not interpret any of it — it is handed
    -- back to the plugin exactly as it was captured — and because a record that has since been
    -- re-tagged, merged or deleted from the catalog must still scrobble as what actually aired.
    payload jsonb not null,
    -- When it went to air. The value the service is told, so it is the moment of the broadcast and
    -- never the moment of the send.
    played_at timestamptz not null,
    -- The earliest this may be sent: `played_at` plus half the record's length, capped at four
    -- minutes. That is the rule the services themselves publish for when a listen counts, and it is
    -- a sensible general one — it is the earliest point at which somebody can be said to have heard
    -- the record rather than caught the front of it.
    eligible_at timestamptz not null,
    -- Consecutive failures. Reset on nothing, unlike `track_audio.attempts`: there is no success
    -- state for a row here, because a row that succeeded is deleted.
    attempts integer not null default 0,
    -- The backoff. `now()` for a fresh row, so `eligible_at` alone governs the first attempt.
    next_attempt_at timestamptz not null default now(),
    -- Why the last attempt failed, for an operator wondering why a queue is not draining. The
    -- plugin's own summary, never an upstream body.
    last_error text
);

-- The drain's own read: what is due, oldest first, for one station. Every column the sweep filters
-- on, in the order it filters them.
create index scrobble_queue_due_idx on deadair.scrobble_queue (station_key, plugin_id, eligible_at, next_attempt_at);

-- migrate:down

drop table if exists deadair.scrobble_queue;
