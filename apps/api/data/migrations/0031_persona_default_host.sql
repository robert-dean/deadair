-- migrate:up

-- `active` was the wrong name for what this column holds, and the wrong name cost the console a true
-- answer. It is the station's OWN host: who presents when the broadcast on air names nobody. Who is
-- actually speaking is the running order's `persona_id` falling back to this, which the personas
-- response now answers as a derived `presenting` rather than storing anywhere.
--
-- The name mattered because a reader who has not read `PersonaRepository.presenting` reasonably takes
-- "active" to mean "on air", which is true on an ordinary station and false during any show that
-- named its own host. The personas page badged the wrong character for exactly that reason.
--
-- A rename rather than a new column plus a backfill: the value is unchanged, every reader moves with
-- it in this commit, and two columns holding one fact is the drift this rename exists to prevent.
alter table deadair.personas rename column active to default_host;

-- Both follow the column. The index is what makes "one per station" a fact rather than a convention,
-- and the check is what keeps a caller from ever being it; neither changes meaning here.
alter index deadair.personas_one_active_idx rename to personas_one_default_host_idx;
alter table deadair.personas rename constraint personas_caller_inactive_check to personas_caller_not_default_check;

-- migrate:down

alter table deadair.personas rename constraint personas_caller_not_default_check to personas_caller_inactive_check;
alter index deadair.personas_one_default_host_idx rename to personas_one_active_idx;
alter table deadair.personas rename column default_host to active;
