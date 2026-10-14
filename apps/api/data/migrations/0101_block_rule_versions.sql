-- migrate:up

-- A never-play rule can refuse a VERSION of a record as well as a genre or a tag: `version` with the
-- value `live` refuses a live recording.
--
-- A third field rather than a tag, because nothing tags one: on the live station, 2026-10-14, no track
-- or album in 5485 carried a `live` tag, and searching titles for the word also catches "Live Wire" and
-- "Live And Let Die". So the rule reads the version markers a provider writes on the title and the
-- album ("War Pigs - Live", "Live in Nottingham"), and `director/live.version.ts` is that reader. The
-- value is checked here as well as in the API, because a version this station cannot read would be
-- a rule that silently refuses nothing.
alter table deadair.block_rules drop constraint block_rules_field_check;
alter table deadair.block_rules add constraint block_rules_field_check check (field in ('genre', 'tag', 'version'));
alter table deadair.block_rules add constraint block_rules_version_check check (field <> 'version' or value = 'live');

-- migrate:down

delete from deadair.block_rules where field = 'version';
alter table deadair.block_rules drop constraint block_rules_version_check;
alter table deadair.block_rules drop constraint block_rules_field_check;
alter table deadair.block_rules add constraint block_rules_field_check check (field in ('genre', 'tag'));
