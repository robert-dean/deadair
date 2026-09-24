-- migrate:up

-- Whether the station stood down because its running order RAN OUT, rather than because somebody
-- stopped it.
--
-- `active` alone could not say, and the schedule needs to know. A block whose "When it runs out" is
-- Stop stands the station down when its records are spent, and the schedule's tick leaves a stood-down
-- station alone, because Stop is an operator saying out of service and a timer must not overrule it.
-- The two stand-downs were the same row, so a block that ran out took every block after it off the
-- air as well: the tick saw a station somebody had stopped and never changed it over again.
--
-- This is the difference, stored where `active` is and for `active`'s reason: a restart must answer
-- the same way the running process would have, and memory does not survive one. Cleared by every
-- `goOnAir` and by an operator's own Stop, so it is only ever true of the stand-down it describes.
alter table deadair.station_air add column ran_out boolean not null default false;

-- migrate:down

alter table deadair.station_air drop column if exists ran_out;
