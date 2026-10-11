-- migrate:up

-- Why a measurement failed, as the analyzer's own code rather than prose, so the two failures that
-- mean different things can be retried on different clocks.
--
-- `undecodable` is a property of the FILE: retrying it is a full download and decode of the same
-- bytes, so it keeps the long wait. `unfetchable` (and `truncated`, a fetch that delivered some bytes)
-- is a property of the binding or the moment, and a day is longer than that usually lasts. A binding
-- that keeps failing is already taken out of the walk by `track_sources.missing_at`, so a short retry
-- cannot become a loop on a dead one. Null is a failure from somewhere else, retried as undecodable.
--
-- No backfill: the old rows' codes are only in `failure_reason`, and treating them as undecodable is
-- exactly what they were before this column existed.
alter table deadair.track_analysis
    add column failure_code text constraint track_analysis_failure_code_check check (
        failure_code is null
        or (failed_at is not null and failure_code in ('unfetchable', 'undecodable', 'truncated'))
    );

-- migrate:down

alter table deadair.track_analysis drop column failure_code;
