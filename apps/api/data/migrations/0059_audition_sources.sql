-- migrate:up

-- An audition from a playlist the station owns, or from a published chart, beside a provider's
-- playlist: the same three sources a broadcast can be built from.
--
-- An audition only ever needs a record's title, lead artist and whatever the catalog knows, so
-- neither new source needs what airing one does. A station playlist's placeholders are records the
-- library does not hold yet, and they are still records a host can talk about; a chart's entries are
-- never looked up or ingested, because nothing here is fetched or played.
--
-- Neither new column is a reference, against `schedule_slots.source_station_playlist_id`: a slot
-- READS its playlist when it starts, so a deleted one has to fall back to something, while an
-- audition's records were copied onto the row when it was asked for. A run whose playlist was later
-- deleted is still the measurement it was, and `source_name` already keeps it readable.
alter table deadair.persona_auditions
    alter column source_plugin_id drop not null,
    alter column source_playlist_id drop not null,
    add column source_station_playlist_id uuid,
    add column source_chart_id text check (source_chart_id is null or length(btrim(source_chart_id)) > 0),
    -- Exactly one source. The provider's playlist is the plugin and its id together, never half of it.
    add constraint persona_auditions_source_check check (
        (source_plugin_id is not null and source_playlist_id is not null)::int
            + (source_station_playlist_id is not null)::int
            + (source_chart_id is not null)::int = 1
        and (source_plugin_id is null) = (source_playlist_id is null)
    );

-- migrate:down

-- A run from either new source has nothing to put in the two columns that become required again, so
-- it goes, and its breaks with it through the cascade.
delete from deadair.persona_auditions where source_plugin_id is null;

alter table deadair.persona_auditions
    drop constraint persona_auditions_source_check,
    drop column source_chart_id,
    drop column source_station_playlist_id,
    alter column source_playlist_id set not null,
    alter column source_plugin_id set not null;
