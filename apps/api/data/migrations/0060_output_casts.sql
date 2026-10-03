-- migrate:up

-- The speakers the station has been asked to play on, and is still meant to be playing on.
--
-- A row is the operator's instruction, not the speaker's state: it exists from the moment somebody
-- casts until somebody stops it, or until the speaker plainly moves on to something else. The
-- supervisor in the outputs module reads these rows to put a speaker back on the station after the
-- stream drops, and after the station itself restarts, which is the whole reason this is a table and
-- not memory: a cast that a restart forgot is a kitchen that went quiet with nobody having asked.
--
-- What the speaker is actually doing is asked of the plugin each time and never stored here, since
-- it changes every few seconds and the plugin is the one that knows.
create table deadair.output_casts (
    -- Present for the reason it is on every other station-owned table.
    station_key text not null default 'main',
    -- Manifest id of the `output` plugin that drives the speaker. A soft reference, as everywhere:
    -- a row for a plugin that has been uninstalled is kept, and skipped, until somebody stops it.
    plugin_id text not null,
    -- The plugin's own id for the speaker, as `OutputDevice.id` gave it.
    device_id text not null,
    -- What the speaker was called when the cast started, so the console can name a cast whose
    -- plugin is not answering.
    device_name text not null,
    -- Which mount it plays, as a same-origin path (`/live.mp3`). The URL is rebuilt from the
    -- station's public address each time, so a changed address is picked up on the next replay.
    mount_path text not null,
    started_at timestamptz not null default now(),
    -- Who started it. Nullable, and set null rather than cascading, because a speaker someone
    -- started keeps playing after their account is removed until somebody stops it.
    started_by uuid references deadair.actors (id) on delete set null,

    primary key (station_key, plugin_id, device_id)
);

-- migrate:down

drop table if exists deadair.output_casts;
