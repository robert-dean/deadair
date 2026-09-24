-- migrate:up

-- Where the station has read up to, on each chat platform it listens on.
--
-- A messaging plugin is asked for new messages in a loop the station owns, with a cursor it handed
-- back last time (see the SDK's `capabilities/messaging.ts`). The cursor is kept here rather than in
-- memory because a restart must neither answer a command twice nor miss one that arrived while the
-- station was down. It is opaque: the station stores it and hands it back and never reads it.
--
-- **Keyed on the plugin alone.** A plugin is one install with one configuration, so it has one
-- position in its platform's stream. Not a foreign key, for the reason `scrobble_queue.plugin_id`
-- gives: an uninstalled plugin reinstalled later should resume where it was rather than from nothing.
create table deadair.messaging_cursors (
    plugin_id text not null primary key,
    cursor text not null,
    updated_at timestamptz not null default now()
);

-- migrate:down

drop table if exists deadair.messaging_cursors;
