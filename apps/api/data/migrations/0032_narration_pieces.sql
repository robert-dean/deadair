-- migrate:up

-- The pieces of somebody else's writing that this station knows about, and what it has done with
-- each: whether it has spoken the words, and whether it has aired them.
--
-- `podcast_episodes`' argument exactly, one capability over, and the same division: a narration
-- plugin says what a series holds, and every column past the description is a fact about the
-- STATION. A plugin cannot know that this station read chapter four on Tuesday, and one asked to
-- remember it would be holding station state where a reinstall loses it.
--
-- What differs from an episode is where the audio comes from. An episode is FETCHED from an address
-- its publisher wrote, so the row tracks a download. A piece is SPOKEN by the station's own engine,
-- which is many takes joined into one, so the row tracks a production instead: `production_id` while
-- it is being made and `segment_id` once the joined audio exists.
--
-- One row per piece per station, keyed by the series and the plugin's own id for the piece. That id
-- is a de-duplication contract on the capability (`capabilities/narration.ts`), which is what makes
-- a refresh an upsert. It matters more here than it does for a podcast: an episode listed twice
-- costs a second download, where a piece listed twice costs the station's only speech engine the
-- time to say a whole chapter over again.
--
-- Rows are kept when a series stops listing a piece, on the same terms: a chapter read last month
-- has not stopped having been read.
create table deadair.narration_pieces (
    id uuid not null default gen_random_uuid() primary key,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now() check (updated_at >= created_at),
    station_key text not null default 'main',
    -- The series, as the host qualifies it: the plugin's id, a colon, the plugin's own id for the
    -- series (`deadair.audiobook:frankenstein`). Text and not a reference, for `show_id`'s reason.
    series_id text not null,
    -- The plugin's own id for the piece. Stable across calls by contract.
    piece_id text not null,

    -- What the plugin said, as of the last refresh. Re-written every time, because the plugin is the
    -- authority on all of it and none of it is a decision the station made.
    series_title text not null,
    title text not null,
    -- How the series is worked through, copied from the series onto every one of its pieces: `serial`
    -- reads from the beginning in `ordinal` order, `latest` takes the newest by `published_at` and
    -- nothing once it has aired. Denormalised deliberately: the one question every read of this
    -- table asks is "what is next for this series", and a series table nothing else needs would exist
    -- only to answer it. Free text with no check, on `segments.kind`'s rule: the vocabulary belongs to
    -- the capability, and a value this schema has never heard of must not need a migration.
    series_order text not null default 'serial',
    author text,
    summary text,
    artwork_url text,
    language text,
    url text,
    -- Where this comes in a `serial`, counting from 0. Null for a `latest` series, and for a serial
    -- piece whose plugin did not say, which is one the refresh drops rather than stores.
    ordinal integer constraint narration_pieces_ordinal_check check (ordinal is null or ordinal >= 0),
    -- What a `latest` series is ordered by. Null is ordinary for a serial.
    published_at timestamptz,
    -- Roughly how many words it runs to, as the plugin counted them. The only length the station has
    -- before it has spoken anything, so it is what the running order is projected against while the
    -- audio is still being made.
    word_count integer constraint narration_pieces_word_count_check check (word_count is null or word_count > 0),
    -- When a refresh last saw it listed. Not the same as `created_at`: a piece can be listed for
    -- months before the station reaches it.
    seen_at timestamptz not null default now(),

    -- What the station has done with it. Nothing below is ever written by a refresh.
    --
    -- The production whose beats are this piece being spoken, while it is being made. Set when the
    -- render job opens one and cleared when that production fails, which is what lets the piece be
    -- tried again. `on delete set null`, because an operator cancelling a production must not take
    -- the station's memory of the piece with it.
    production_id uuid references deadair.productions (id) on delete set null,
    -- The joined audio, once every beat has been spoken and the mixer has put them together. This is
    -- what a band actually places, and having it is what "rendered" means.
    segment_id uuid references deadair.segments (id) on delete set null,
    -- When a render was last ASKED for, which is what keeps asking idempotent, exactly as
    -- `fetch_requested_at` does one table over: the scheduler claims the row by moving this forward,
    -- and a render that died without a word is asked for again once it is old enough.
    render_requested_at timestamptz,
    -- How many renders have failed in a row, and why the last one did. Cleared by a success.
    render_attempts integer not null default 0 constraint narration_pieces_render_attempts_check check (render_attempts >= 0),
    render_error text,
    -- The slot the station made it for, so the console can say "wanted at ten" beside a render.
    scheduled_for timestamptz,
    -- When a listener could first have heard it. A piece is aired once; this is what says so, and for
    -- a serial it is also the station's place in the book.
    aired_at timestamptz,

    constraint narration_pieces_piece_unique unique (station_key, series_id, piece_id)
);

select deadair.add_updated_at_trigger('deadair.narration_pieces');

-- The two orders a series can be worked through, which are the two reads this table exists for. The
-- serial one is also how the console lists a book.
create index narration_pieces_serial_idx on deadair.narration_pieces (station_key, series_id, ordinal, id);
create index narration_pieces_latest_idx on deadair.narration_pieces (station_key, series_id, published_at desc nulls last, id);

-- Which piece a segment is, from the segment's side: the director marks a piece aired from the
-- segment it just played.
create index narration_pieces_segment_idx on deadair.narration_pieces (segment_id) where segment_id is not null;

-- And which piece a production belongs to, for the sweep that attaches a finished one.
create index narration_pieces_production_idx on deadair.narration_pieces (production_id) where production_id is not null;

-- migrate:down

drop table deadair.narration_pieces;
