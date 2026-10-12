-- migrate:up

-- Whether a production handed nothing to read should go and find something: its subject searched on the
-- sites the operator trusts, and the pages that come back read for notes as any source is.
--
-- A flag rather than sources written at commission, because finding them is a search and several page
-- reads, which is the research pass's work and not a request's: the pass reads the flag, asks every
-- enrichment plugin that implements `enrichTopic`, and writes what came back as the production's
-- sources before taking notes from them. Only the operator's trusted sites are ever read, which is
-- websearch's own line: the station quotes sites its operator chose, never whatever an engine ranked
-- first.
alter table deadair.productions add column research boolean not null default false;

-- The same, as a standing choice for one of the station's own shows, so every episode of it is
-- researched without anybody having to ask.
alter table deadair.own_shows add column research boolean not null default false;

-- migrate:down

alter table deadair.own_shows drop column research;
alter table deadair.productions drop column research;
