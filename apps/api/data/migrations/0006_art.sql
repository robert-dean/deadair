-- migrate:up

-- Locally cached artwork, so the console renders the station's own copy instead of hotlinking
-- somebody else's CDN.
--
-- A row is keyed by the upstream URL, which is the only identity the writers of
-- `artists.image_url` / `albums.image_url` agree on: enrichment promotes a Cover Art Archive URL,
-- catalog ingest promotes a Spotify one, and neither knows about this table. Catalog reads join
-- back on that URL, so nothing here needs a second writer on the catalog tables.
--
-- `id` is the public handle: it appears in the URL the API serves the bytes under and never
-- changes. `checksum` is the file on disk (content-addressed under ART_DIR) and may change under a
-- stable id if the same source_url is ever refetched, which is what the served ETag is for.
--
-- A row with a null checksum is a known failure, not a cache hit: the fetch was tried and did not
-- produce usable bytes. Reads require `checksum is not null`; the sweeper skips anything whose
-- next_attempt_at is still in the future, so a dead URL backs off instead of being retried every
-- pass forever.
create table deadair.art_assets (
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now() check (updated_at >= created_at),
    id uuid not null default gen_random_uuid() primary key,
    source_url text not null unique,
    -- sha256 of the bytes, hex. Null until a fetch succeeds.
    checksum text,
    -- Filename extension on disk, from the response's content type.
    ext text,
    content_type text,
    byte_size integer,
    fetched_at timestamptz,
    attempts integer not null default 0,
    last_error text,
    -- Backoff gate for the sweeper. Null once the bytes are in hand.
    next_attempt_at timestamptz
);
select deadair.add_updated_at_trigger('deadair.art_assets');

-- The sweeper's queue: rows with no bytes yet, oldest attempt first. Partial, because a cached row
-- never appears in it again.
create index art_assets_pending_idx on deadair.art_assets (next_attempt_at nulls first) where checksum is null;

-- Two source URLs that turn out to be the same image share one file on disk; this is how the
-- cacher finds the existing one rather than writing it twice.
create index art_assets_checksum_idx on deadair.art_assets (checksum) where checksum is not null;

-- migrate:down

drop table if exists deadair.art_assets;
