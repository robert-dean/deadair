-- migrate:up

-- A playlist placeholder may be known by its description alone.
--
-- 0005 required every unresolved row to carry a provider's id, because the only import it imagined
-- was a clone of a provider's playlist, where every record arrives with one. A playlist read from a
-- file does not: an M3U or an `Artist - Title` list names records and nothing else. Refusing such a
-- row would drop the record and its place in the order, which is the lossy import 0005 exists to
-- prevent, so a row may now be a snapshot with no upstream id at all.
--
-- What 0005 forbade still holds: a placeholder whose id has no plugin to interpret it. A row that
-- names a plugin still needs its id, and a row that names neither is resolved by its snapshot, which
-- `catalog.resolve_placeholders` already parses for the second rung of its match.
alter table deadair.playlist_tracks drop constraint playlist_tracks_resolved_check;
alter table deadair.playlist_tracks add constraint playlist_tracks_resolved_check check (
    track_id is not null
    or (origin_plugin_id is not null and origin_external_id is not null)
    or (origin_plugin_id is null and origin_external_id is null and origin_snapshot is not null)
);

-- migrate:down

delete from deadair.playlist_tracks where track_id is null and origin_plugin_id is null;
alter table deadair.playlist_tracks drop constraint playlist_tracks_resolved_check;
alter table deadair.playlist_tracks add constraint playlist_tracks_resolved_check check (
    track_id is not null or (origin_plugin_id is not null and origin_external_id is not null)
);
