-- migrate:up

-- What a show is, in a sentence or two, for the people listening to it.
--
-- A slot already has two pieces of text, and neither is this. Its `label` is the show's name. Its
-- `brief` is written for the PRESENTER and the model choosing the records ("late-night soul, nothing
-- after 1985, ease off the ballads"), and it is read into prompts, so it is no place for words meant for
-- a listener, and words meant for a listener are no place to steer the picks from. This column is the
-- listener's half: the timetable and now playing show it, and nothing reads it into a prompt.
--
-- Null is none, which is every slot written before this column existed, and a show with no description
-- shows nothing in its place: never the brief.
alter table deadair.schedule_slots add column description text;

-- migrate:down

alter table deadair.schedule_slots drop column description;
