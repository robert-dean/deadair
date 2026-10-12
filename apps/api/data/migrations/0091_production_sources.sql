-- migrate:up

-- What a production was handed to read: pasted text, and later a page or a search's findings, each
-- with the title it goes by and where it came from.
--
-- A production states as fact only what its notes give (0090), and nobody types notes for a podcast
-- about a long article. So a production can be handed SOURCES instead, and a research pass reads them
-- before anything else runs: it asks the model for short claims with the words that state each one,
-- keeps a claim only when those words really are in the source, and writes what survives as the
-- notes. The sources are kept beside the notes rather than discarded, because "where did the
-- programme get that" is a question an operator asks after it has aired, and the answer is here.
--
-- A jsonb array of `{ url?, title, text?, retrievedAt? }`, read only ever whole, as the notes are.
-- Null is a production handed nothing to read, which is every row before this and most rows after it.
alter table deadair.productions add column sources jsonb constraint productions_sources_check check (sources is null or jsonb_typeof(sources) = 'array');

-- `researching` is the research pass holding the row, on the pattern of every other pass's state:
-- claimed out of `planned` and handed back to `planned` for the pass the writing mode starts with, so
-- a restart mid-read finds the row where a claim can see it.
alter table deadair.productions drop constraint productions_state_check;
alter table deadair.productions add constraint productions_state_check check (
    state in ('planned', 'researching', 'outlining', 'drafting', 'checking', 'rendering', 'stitching', 'ready', 'aired', 'failed', 'cancelled')
);

-- migrate:down

update deadair.productions set state = 'failed', error = coalesce(error, 'researching when the research pass was removed') where state = 'researching';
alter table deadair.productions drop constraint productions_state_check;
alter table deadair.productions add constraint productions_state_check check (
    state in ('planned', 'outlining', 'drafting', 'checking', 'rendering', 'stitching', 'ready', 'aired', 'failed', 'cancelled')
);
alter table deadair.productions drop column sources;
