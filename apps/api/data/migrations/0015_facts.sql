-- migrate:up

-- What the station believes about a record, and where it read it.
--
-- Enrichment already stores what a PLUGIN said, per provider, in `track_enrichment` and its two
-- siblings. This is a different kind of thing and that is why it is not a column on those: a row
-- here is one CLAIM, in one sentence, extracted by this host out of prose somebody else wrote, and
-- carrying the span of that prose which supports it. A plugin's payload is an answer; a fact is an
-- argument, and it keeps its evidence.
--
-- The rule the whole table exists to enforce is that **a claim with no source does not exist**.
-- `source_url` and `source_quote` are `not null` for that reason and no other. A nullable column is
-- a rule that will be broken by the first writer in a hurry, and the failure it produces is the one
-- thing this feature must never do: a DJ saying something specific, checkable and untrue, in exactly
-- the voice it uses for the things that are true.
--
-- Not append-only, unlike `station_events` and `segment_events`. A fact is a standing belief rather
-- than a record of a moment, and `last_used_at` is written every time one is put in front of a
-- writer, so it takes the `updated_at` trigger like the catalog tables do.
create table deadair.facts (
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now() check (updated_at >= created_at),
    id uuid not null default gen_random_uuid() primary key,
    station_key text not null default 'main',
    -- What this claim is about, as three nullable references and exactly one of them set.
    --
    -- A single polymorphic `subject_id` would have been shorter and would have had no foreign key at
    -- all, so a deleted track would leave its facts behind to be read back by a later track that
    -- happened to reuse nothing — orphans that nothing would ever notice, because a fact is read by
    -- id and never enumerated. Cascading from three real references costs a check constraint and
    -- makes the question unanswerable instead.
    --
    -- Three levels because the reader wants three: `factsForTracks` already prefers what is known
    -- about this recording, then about its record, then about whoever made it.
    track_id uuid references deadair.tracks (id) on delete cascade,
    album_id uuid references deadair.albums (id) on delete cascade,
    artist_id uuid references deadair.artists (id) on delete cascade,
    constraint facts_subject_check check (num_nonnulls(track_id, album_id, artist_id) = 1),
    -- The sentence, neutral and speakable, as the extractor produced it. Capped well below what a
    -- text column would take: a claim is one thing a DJ says in passing, anything longer is a
    -- paragraph that arrived in the wrong field, and this column is half of a unique index.
    claim text not null constraint facts_claim_length_check check (char_length(claim) between 1 and 500),
    -- What sort of fact it is, which is what lets one persona reach for a different one than another
    -- and gives a writer something to build around. Constrained rather than free text so a filter
    -- cannot silently miss a typo'd category; nothing has shipped, so a new one is an edit to this
    -- line rather than a migration around it.
    category text not null default 'summary' constraint facts_category_check check (
        category in ('summary', 'placement', 'chart', 'recording', 'personnel', 'controversy', 'cover_or_sample', 'ending')
    ),
    -- Which extractor produced it, and the reason the column exists is that the two can be replaced
    -- independently. `lead` is the deterministic floor: the opening sentence of an article, taken
    -- verbatim, which needs no model and cannot hallucinate because the claim and the quote are the
    -- same span. `model` is everything a lead sentence cannot carry — placements, samples, the story
    -- behind a recording — and is the half worth re-running when a prompt improves.
    source text not null constraint facts_source_check check (source in ('lead', 'model')),
    -- The enrichment plugin whose document this came out of, so a source that turns out to be
    -- unreliable can be answered for. Not a foreign key: a plugin can be uninstalled, and what it
    -- told the station remains true.
    source_provider text not null,
    -- Where a person reads it. This is the address an operator opens when something sounds wrong on
    -- air, which is the only reason any of this is trustworthy.
    source_url text not null,
    -- The span of the source that supports the claim, quoted rather than summarised. The
    -- verification pass compares these two and nothing else, so a quote that does not occur in the
    -- document is how a fabricated claim is caught.
    source_quote text not null,
    -- How sure the extractor was, 0 to 1. Null for the lead sentence, which is not a judgement:
    -- the claim IS the quote there, so there is nothing to be confident about.
    confidence real constraint facts_confidence_check check (confidence is null or confidence between 0 and 1),
    -- Which model wrote it, for `source = 'model'`. Null for the floor, which used none.
    model text,
    extracted_at timestamptz not null default now(),
    -- When this fact was last handed to something that writes. The cooldown, so the same good line
    -- does not come round every third rotation.
    --
    -- Stamped at SELECTION rather than when the break actually airs, and that is a deliberate
    -- inaccuracy: a written break can still be dropped before its slot by the forward-claim check,
    -- so a fact can rest a week over a break nobody heard. The honest alternative is a reader of
    -- `segment_events` that stamps this on the airing edge, which is a great deal of machinery for
    -- the difference between "used" and "used and heard".
    last_used_at timestamptz
);

select deadair.add_updated_at_trigger('deadair.facts');

-- One claim per subject, however many times it is extracted. The extractor is re-run whenever a
-- prompt changes, and a model handed the same article twice will produce the same sentence twice;
-- this is what makes that free rather than a slowly duplicating store.
--
-- Three partial indexes rather than one over the subject columns, because NULL is never equal to
-- NULL: a single `unique (track_id, album_id, artist_id, claim)` would let every album and artist
-- claim duplicate freely, since two of its three columns are null on every row.
create unique index facts_track_claim_idx on deadair.facts (track_id, claim) where track_id is not null;
create unique index facts_album_claim_idx on deadair.facts (album_id, claim) where album_id is not null;
create unique index facts_artist_claim_idx on deadair.facts (artist_id, claim) where artist_id is not null;

-- The read the break writer makes: everything known about these few subjects, coldest use first so
-- the cooldown can be applied without sorting the result. `station_key` leads because a fact is a
-- per-station belief, exactly as `play_history`'s indexes lead with it.
create index facts_track_idx on deadair.facts (station_key, track_id, last_used_at nulls first) where track_id is not null;
create index facts_album_idx on deadair.facts (station_key, album_id, last_used_at nulls first) where album_id is not null;
create index facts_artist_idx on deadair.facts (station_key, artist_id, last_used_at nulls first) where artist_id is not null;

-- What has already been read, so the walk converges.
--
-- Without this the extractor has no way to tell an article it has never seen from one it read and
-- got nothing out of, and the second is common: plenty of articles carry no claim this station would
-- ever say. It would re-read those every fifteen minutes, forever, which for the model pass means
-- spending the station's one model slot on the same dead article for the life of the install.
--
-- The same shape of answer as `ENRICHMENT_MISS_TTL_MS` on the enrichment walk, and for the same
-- reason: the work has to be its own record, or it is done again.
--
-- Append-only. A re-extraction under a better prompt deletes the rows for that `source` and writes
-- new ones, rather than editing these.
create table deadair.fact_extractions (
    created_at timestamptz not null default now(),
    id uuid not null default gen_random_uuid() primary key,
    station_key text not null default 'main',
    track_id uuid references deadair.tracks (id) on delete cascade,
    album_id uuid references deadair.albums (id) on delete cascade,
    artist_id uuid references deadair.artists (id) on delete cascade,
    constraint fact_extractions_subject_check check (num_nonnulls(track_id, album_id, artist_id) = 1),
    -- Which pass read it. They are tracked apart so that turning a model on later re-reads every
    -- article the floor has already been over, rather than skipping them as done.
    --
    -- `gloss` writes no fact at all: it fills `deadair.pronunciations` from the pronunciation key an
    -- article printed for itself. It is marked here anyway, because what this column names is a
    -- READER rather than a kind of fact — the question is "has this pass been over this document" —
    -- and a second table asking that would be this table with another name.
    source text not null constraint fact_extractions_source_check check (source in ('lead', 'model', 'gloss')),
    -- Which document, by the address it was cited under. A plugin that later hands over a different
    -- article about the same record is a new row and gets read.
    document_url text not null,
    -- How many claims survived. Zero is the interesting value and the reason this table exists.
    claims integer not null default 0
);

create unique index fact_extractions_track_idx on deadair.fact_extractions (track_id, source, document_url) where track_id is not null;
create unique index fact_extractions_album_idx on deadair.fact_extractions (album_id, source, document_url) where album_id is not null;
create unique index fact_extractions_artist_idx on deadair.fact_extractions (artist_id, source, document_url) where artist_id is not null;

-- migrate:down

drop table if exists deadair.fact_extractions;
drop table if exists deadair.facts;
