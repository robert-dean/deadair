-- migrate:up

-- The station's numbers over time: how many were listening, how long the work took, what the model
-- was asked for. Everything the console's Check-up shows is NOW, and Traces keeps a week of decisions
-- in files; nothing kept a number long enough to see a trend in it, so an operator asking whether the
-- audience is growing, or whether the model got slower this month, had nothing to read.
--
-- The shape is `@maroonedsoftware/telemetry/kysely`'s reference table, with `station_key` in front of
-- the key like every other per-station table. That package's `MetricsStore` is the only writer and
-- the only reader, so its column names are fixed here rather than chosen.
--
-- One row is one SERIES over one BUCKET, never one observation. The metrics module folds everything
-- observed in a minute into five numbers in memory and upserts them once a minute; a later flush of
-- the same minute merges into the row rather than adding one. So the table grows with the number of
-- distinct series, not with how busy the station is, which is what lets it keep a year:
--
--   - `minute` rows are written by that flush and kept for `metrics.minuteRetentionDays` (a week).
--   - `hour` rows are folded from them by the hourly `metrics.rollup` job and kept for
--     `metrics.hourRetentionDays` (thirteen months, so this month can be read against the same month
--     last year).
--
-- No percentiles. The five aggregates are a gauge's last value, a counter's sum, and a duration's mean
-- and worst; a percentile needs a histogram per bucket, and the mean beside the max is enough to see
-- that something got slow.
create table deadair.metric_samples (
    station_key text not null default 'main',
    resolution text not null constraint metric_samples_resolution_check check (resolution in ('minute', 'hour')),
    -- The start of the minute or hour, UTC.
    bucket timestamptz not null,
    -- Dotted, with the unit last where there is one: `station.listeners`, `work.job.ms`.
    name text not null,
    -- What tells one series of a metric from another: `{"queue":"catalog.sync"}`. Small closed sets
    -- only (a queue, a plugin, a kind of call); an id in a label is a row per minute per id.
    labels jsonb not null default '{}',
    -- The labels as sorted JSON, so they can sit in the primary key where `jsonb` cannot be compared
    -- cheaply. Written by the store from `labels`, never by hand.
    labels_key text not null,
    -- `station` for what the station measured itself; `otlp` for what another service sent it.
    source text not null default 'station',
    count double precision not null,
    sum double precision not null,
    min double precision not null,
    max double precision not null,
    last double precision not null,
    primary key (station_key, resolution, name, labels_key, bucket)
);

-- Range reads and the prune both walk by bucket within a resolution.
create index metric_samples_bucket_idx on deadair.metric_samples (station_key, resolution, bucket);

-- migrate:down

drop table deadair.metric_samples;
