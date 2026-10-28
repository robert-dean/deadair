-- migrate:up

-- Why the model picked a record, in its own words, kept beside the record in the as-run log.
--
-- Set only when `llm.setReasons` was on and the model, rather than the station's own draw, named the
-- record; null for every break and every other record. Nothing reads it to decide anything: it is
-- shown under the record on As run and that is all. On this table rather than `play_history`, which
-- the repeat window and the cooldowns query on every pick and has no use for a sentence.
alter table deadair.as_run
    add column picked_because text constraint as_run_picked_because_check check (picked_because is null or length(picked_because) <= 200);

-- migrate:down

alter table deadair.as_run drop column picked_because;
