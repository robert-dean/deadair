-- migrate:up

-- The stored claims a written break was handed, and which of them it said.
--
-- `deadair.facts` keeps every claim with the span of the article that states it, so that somebody
-- can go and check. Until this table nothing kept which BREAK a claim went into: the enrichment read
-- handed the writer bare sentences and stamped `facts.last_used_at`, and the console could show
-- where a record's facts came from but never where the host got the thing it just said. This is that
-- link, keyed on the segment because the segment is what airs (`RundownItem.externalId` for a render
-- item, and `as_run.segment_id`), where `script_history` is per attempt and swept nightly.
--
-- Claims only. A provider line has no source, and a row here without one would be the thing
-- `facts.source_url` is `not null` to prevent: a sentence presented as checkable that is not.
--
-- One break's rows are REPLACED on every write of it, never added to, on `persona_tellings`' reason:
-- segments are reopened and rewritten constantly, and only the words that air are evidenced by them.
-- Append-only otherwise, for `script_history`'s reason, so there is no `updated_at`.
create table deadair.segment_facts (
    id uuid not null default gen_random_uuid() primary key,
    created_at timestamptz not null default now(),
    -- Whose break this was, as on every other station-owned table.
    station_key text not null default 'main',
    -- CASCADE, unlike `persona_tellings.segment_id`: a source is shown BESIDE its break, and a row
    -- whose break is gone has nothing left to be shown beside.
    segment_id uuid not null references deadair.segments (id) on delete cascade,
    -- The claim it was. `set null` rather than cascade, because a fact goes with its track, album or
    -- artist (`0015_facts.sql`) and the record of what a break was handed must not go with it. The
    -- four columns after this are why the row survives that: they are copied, as
    -- `persona_notes.source_quote` is, for the same reason.
    fact_id uuid references deadair.facts (id) on delete set null,
    -- The sentence the writer was handed, as it stood when it was handed.
    claim text not null check (length(btrim(claim)) > 0),
    -- Where it came from and the words there that state it. `not null` on `facts`' own argument.
    source_url text not null,
    source_quote text not null,
    -- The plugin that fetched the article, for the label beside the link.
    source_provider text not null,
    -- Whether the words that were written said it, as the STATION read them back (`mentionsFact`).
    --
    -- Never the model's own word for it, on `persona_tellings.told`'s reason. A claim offered as a
    -- note may simply be ignored, and the read-back undercounts rather than overcounts (a figure
    -- spelt out is missed), so a source shown to somebody as what the host said errs towards absent.
    told boolean not null
);

-- A break is handed a claim once, and this is what makes a replacement unable to double one.
create unique index segment_facts_segment_fact_idx on deadair.segment_facts (segment_id, fact_id) where fact_id is not null;

-- The one read there is: this break's sources.
create index segment_facts_segment_idx on deadair.segment_facts (station_key, segment_id);

-- migrate:down

drop table if exists deadair.segment_facts;
