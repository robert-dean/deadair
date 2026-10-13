-- migrate:up

-- A listener may overrule the station when it turns their request down for its own taste.
--
-- `overrulable` marks a `declined` row the station refused for a reason a listener is allowed to
-- outvote: the repeat window, the artist cooldown, a dislike, the period or the length. It is decided
-- when the station refuses, by resolving the record once more the way an overruled request is
-- resolved, because the refusal itself cannot say which rule dropped the record. A never-play rule,
-- a clean-only station with no clean copy, or a record nothing serves leaves it false. It is cleared
-- once the listener has insisted, so one refusal is overruled once.
--
-- `insisted` marks the NEW request an overrule writes. It is a new row rather than the declined one
-- reopened, so the arbitration, the approval setting and the two one-open indexes from 0088 all
-- apply to it exactly as they do to any request. It is stored rather than passed along because the
-- request is placed more than once: the minute tick and an operator's grant both place it again, and
-- each has to resolve it as overruled.
alter table deadair.listener_requests add column overrulable boolean not null default false;
alter table deadair.listener_requests add column insisted boolean not null default false;

-- migrate:down

alter table deadair.listener_requests drop column if exists insisted;
alter table deadair.listener_requests drop column if exists overrulable;
