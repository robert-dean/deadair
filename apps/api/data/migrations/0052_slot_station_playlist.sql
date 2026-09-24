-- migrate:up

-- A playlist the station owns, as a slot's source: the third alternative beside the provider pair and
-- the chart. Its records are read from `deadair.playlist_tracks` when the block starts rather than from
-- a provider, so a long pool of records starts on time however slow the provider that lists it is.
--
-- `on delete set null`, as `persona_id` is: a playlist deleted from under the timetable leaves a slot
-- the station fills from its brief, which is a block that still starts rather than one that cannot.
alter table deadair.schedule_slots
    add column source_station_playlist_id uuid references deadair.playlists (id) on delete set null;

-- migrate:down

alter table deadair.schedule_slots drop column source_station_playlist_id;
