-- migrate:up

-- What a weather break was told about the next few hours, so the next one does not say it again.
--
-- A weather break is handed at most two notes about the hours after it airs ("rain likely in about
-- three hours", "down to 4 degrees Celsius by midnight"), and the outlook barely moves between two
-- breaks an hour apart. Said each time, it is the same forecast read out as news every hour. So the
-- break stamps the notes it was GIVEN, each as its kind, its word, how sure it is and the hour it is
-- about, with the place they are for, and the next weather break about the same place leaves out any
-- note that matches one, counting an onset that moved by an hour or less as the same news.
--
-- What the break was given rather than what it said: nothing reads a script for the outlook, and a
-- note given and left out is one the station errs toward not repeating, which is the cheap mistake.
-- Null on every other kind of segment, and on a weather break written before this column existed.
alter table deadair.segments add column outlook_said jsonb;

-- migrate:down

alter table deadair.segments drop column outlook_said;
