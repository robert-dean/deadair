-- migrate:up

-- When re-measuring a record that already holds a whole measurement last went wrong.
--
-- A row is a measurement or a failure, never both (`track_analysis_outcome_check`), and that is right
-- for a record nothing has measured. It is wrong for a record being measured AGAIN: writing the
-- failure throws away cue points and a level that are still true, which a schema bump would do to
-- a record for every passing fetch problem across the whole library. So that failure is kept here,
-- beside the measurement, and all it does is make the walk wait before trying that record again.
alter table deadair.track_analysis add column remeasure_failed_at timestamptz;

-- migrate:down

alter table deadair.track_analysis drop column remeasure_failed_at;
