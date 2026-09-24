-- migrate:up

-- A dedication with a request: who it is for, and what the listener wanted said.
--
-- Both are the listener's own words and are treated that way everywhere they go. They are shown to an
-- operator, and a break writer may PARAPHRASE the message on air, handed it as quoted data with an
-- instruction to leave out anything unfit to broadcast; the floor under that writer never reads the
-- message at all, only the two names. Neither ever reaches `reason`, the activity feed, or anything
-- the station says in its own voice as though it had written it. See `docs/internals/messaging.md`.
alter table deadair.listener_requests add column dedicate_to text;
alter table deadair.listener_requests add column message text;

-- migrate:down

alter table deadair.listener_requests drop column if exists message;
alter table deadair.listener_requests drop column if exists dedicate_to;
