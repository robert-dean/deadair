-- migrate:up

-- Subjects a character takes one at a time: never two of them in one break.
--
-- Each element is ONE subject, written as the comma-separated words that mean it ("bigfoot,
-- sasquatch, yeti"), and a script carrying words from two elements is refused as `mixed-subjects`.
-- Built for the conspiracy host, who believes every classic theory and is told to keep to one per
-- break: the marker check counts HOW MANY of a character's words a script carries and never WHICH, so
-- that instruction had nothing behind it. `persona.sheet.ts` has the rest, beside `subjectsVisited`.
--
-- A jsonb array of strings, as the sheet's other lists are in 0012, and for their reason: the whole
-- sheet crosses the wire as JSON. Empty means nothing is kept apart, which is every row written
-- before this migration.
alter table deadair.personas add column exclusive_subjects jsonb not null default '[]'::jsonb;

-- migrate:down

alter table deadair.personas drop column if exists exclusive_subjects;
