-- migrate:up

-- What an event destination asks for, and how it has been doing, now that the station sends it the
-- moments it airs and not only a test.
--
-- `events` is the subscription: the event types this destination wants. EMPTY MEANS EVERY TYPE, so
-- a destination made before this column existed keeps receiving everything, and a type added later
-- reaches every destination that never narrowed its list. The names are checked by the service
-- against the catalogue rather than here, because the catalogue grows in code.
alter table deadair.event_destinations add column events text[] not null default '{}';

-- Deliveries that failed in a row, where a delivery is one EVENT rather than one attempt: retries
-- inside an event's own lifetime are the broker's, and only the outcome of the last one counts here.
-- Any success sets it back to nothing. At twenty the destination is switched off (below), which is
-- the difference between a receiver that was restarting and one that is gone.
alter table deadair.event_destinations add column consecutive_failures integer not null default 0 check (consecutive_failures >= 0);

-- Why the station turned it off, when the station did. Null for a destination that is on, or that an
-- operator turned off themselves. Turning it back on clears this and the count with it.
alter table deadair.event_destinations
    add column disabled_reason text constraint event_destinations_disabled_reason_check check (disabled_reason is null or disabled_reason in ('failing'));

alter table deadair.event_destinations add column last_delivered_at timestamptz;
alter table deadair.event_destinations add column last_failed_at timestamptz;
-- The station's own sentence about the last failure, never the receiver's response body.
alter table deadair.event_destinations add column last_failure text;

-- The moment (`occurredAt`) of the newest STATE event this destination has taken: something going on
-- air. A retried event older than this is dropped instead of sent, because the job broker does not
-- keep order, and a late "a break started" arriving after "a record started" would turn an on-air
-- light back on for a record.
alter table deadair.event_destinations add column last_state_at timestamptz;

-- migrate:down

alter table deadair.event_destinations drop column last_state_at;
alter table deadair.event_destinations drop column last_failure;
alter table deadair.event_destinations drop column last_failed_at;
alter table deadair.event_destinations drop column last_delivered_at;
alter table deadair.event_destinations drop column disabled_reason;
alter table deadair.event_destinations drop column consecutive_failures;
alter table deadair.event_destinations drop column events;
