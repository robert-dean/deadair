-- migrate:up

-- What a LISTENER may be told this break is, where the writer was willing to say.
--
-- `label` is written for a producer and stays that way: `Talk break: Straight Tequila Night into My
-- Boo`, `Back-announce: …`, `Intro: …`. That is right for the console, the logs and `script_history`,
-- and it is the wrong register for the one line a stream can carry — the example above is verbatim
-- off a hardware player's screen, where it read as the station leaking its own paperwork. So the
-- mount has always shown the station's name for a break instead, which is safe for every kind at once
-- and says nothing about which kind it is.
--
-- Some labels are not paperwork at all. The weather writer's is `Weather` or `Weather: Brooklyn`, the
-- news writer's is `News` or `Sport news`, a story's is the story's own title. Those are lines a
-- listener would understand, and there was no way to tell them apart from the talk break's, because
-- nothing on the row said which kind of label this is.
--
-- This column is the writer saying so. Null is the default and the safe answer: the mount falls back
-- to the station's name exactly as before, so a kind whose writer has never thought about it — and
-- every kind an operator adds later — is unchanged. A value is a promise that these words can be read
-- by somebody who is not running the station.
--
-- Deliberately NOT derived from `kind` by whatever draws the line. That would be a vocabulary in the
-- display layer, kept in step by hand as kinds are added, and the writer is the only thing that knows
-- what its own label says.
alter table deadair.segments add column listener_label text;

-- migrate:down

alter table deadair.segments drop column listener_label;
