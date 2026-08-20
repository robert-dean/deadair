-- migrate:up

-- How the station says a word, as something with evidence behind it.
--
-- This was `render.pronunciations`, a `written => spoken` text setting, and it was right for as long
-- as every entry was a fact an operator typed in. It stopped being right the moment an entry could
-- arrive from somewhere: a mined one carries the article it came from and the sentence that says so,
-- it can be REJECTED in a way that has to outlive the next pass, and none of the three fit on a line
-- with an arrow in the middle of it. That is `clock_bands`' argument one table over — a list leaves
-- a settings box when its entries start referencing something.
--
-- The lexicon itself did not change and is still `applyPronunciations`: one alternation over the
-- script, longest written form first, matched case-insensitively.
create table deadair.pronunciations (
    id uuid not null default gen_random_uuid() primary key,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now() check (updated_at >= created_at),
    -- Whose lexicon this is, as on every other station-owned table.
    station_key text not null default 'main',
    -- What appears in a script, and what is handed to the engine instead. An EMPTY `spoken` is
    -- meaningful and always has been: it drops the words, which is the honest reading for a marker
    -- that got into a title and is not a word. So `not null` with no length floor.
    written text not null check (length(btrim(written)) > 0),
    spoken text not null,
    -- `active` is said. `suggested` is proposed and says nothing yet. `rejected` is an operator
    -- having looked at a proposal and turned it down, which is a fact worth keeping rather than a
    -- row worth deleting: without it the next pass over the same article proposes it again, forever.
    state text not null constraint pronunciations_state_check check (state in ('active', 'suggested', 'rejected')),
    -- Who says so. `gloss` is the pronunciation key an encyclopaedia article printed for itself.
    origin text not null constraint pronunciations_origin_check check (origin in ('operator', 'gloss')),
    -- The evidence, which is what the operator's decision is actually made on. Mirrors `facts`: a
    -- claim with no source must not be expressible, and neither must a way of saying a name that
    -- nothing can be checked against.
    source_url text,
    source_quote text,
    -- What the article was about, so the console can show the record beside the proposal. Not a
    -- foreign key and deliberately so: the entry is about a WORD, and it keeps being right about
    -- that word after the record it was noticed on is merged away.
    subject_kind text constraint pronunciations_subject_check check (subject_kind in ('track', 'album', 'artist')),
    subject_id uuid,
    constraint pronunciations_evidence_check check (origin = 'operator' or (source_url is not null and source_quote is not null))
);

-- One entry per written form, because the lexicon matches case-insensitively: two rows differing
-- only in case are two entries that cannot both be right, and which one wins would come down to the
-- order the planner felt like.
--
-- Partial, and that is the load-bearing half. A rejected row must not stand between an operator and
-- their own entry for the same name — turning down "Madonna => chih-KOH-nee" is not a statement that
-- Madonna may never be given a pronunciation.
create unique index pronunciations_written_idx on deadair.pronunciations (station_key, lower(written)) where state <> 'rejected';

-- The read every render makes: this station's active entries. Ordered by length in the lexicon
-- rather than here, since that is a rule about matching rather than about storage.
create index pronunciations_active_idx on deadair.pronunciations (station_key) where state = 'active';

-- migrate:down

drop table if exists deadair.pronunciations;
