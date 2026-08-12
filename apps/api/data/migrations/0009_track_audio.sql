-- migrate:up

-- The station's own copy of a record, so playing one twice costs one download.
--
-- Every item the transport hands over is a URL Liquidsoap fetches ahead of air, and until now that
-- URL always pointed at the provider: the same bytes were fetched again on every play, and the
-- measurement walk fetched them a third time. A row here means those bytes are on disk under
-- TRACKS_DIR and the URL handed over is the app's own.
--
-- Keyed by the BINDING rather than by the track, because `track_sources` is where "a copy that can
-- actually be served" lives: one canonical track may bind to several copies within one provider,
-- those copies are different files with different loudness and different cue points, and the one
-- that airs is the one that was resolved. Cascade, because a binding that is gone has no copy to
-- talk about — the FILE is not deleted with the row, which is deliberate: nothing evicts yet, and a
-- re-ingest that mints the same binding finds the same bytes already hashed under the same name.
--
-- Shaped on `art_assets` (0006) down to the column list, because it is the same problem: bytes
-- fetched from somewhere else, kept locally, with failures that have to be remembered so a dead
-- source is not re-fetched on every pass forever. A row with a null checksum is a known FAILURE,
-- not a cache hit; reads require `checksum is not null`.
create table deadair.track_audio (
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now() check (updated_at >= created_at),
    id uuid not null default gen_random_uuid() primary key,
    source_id uuid not null unique references deadair.track_sources (id) on delete cascade,
    -- sha256 of the bytes, hex. Null until a fetch succeeds.
    checksum text,
    -- Filename extension on disk, from the response's content type.
    ext text,
    content_type text,
    byte_size integer constraint track_audio_byte_size_check check (byte_size is null or byte_size > 0),
    fetched_at timestamptz,
    attempts integer not null default 0,
    last_error text,
    -- Backoff gate. Null once the bytes are in hand, and what stops a binding the provider will not
    -- serve from being asked again on every single boundary it comes round on.
    next_attempt_at timestamptz
);
select deadair.add_updated_at_trigger('deadair.track_audio');

-- How the resolver asks "is there a copy of this?" on the hand-over path. Partial, because a row
-- with no bytes is answered by the same index the claim uses below.
create index track_audio_cached_idx on deadair.track_audio (source_id) where checksum is not null;

-- What a claim reads: rows with no bytes yet whose backoff has passed. Ordered by attempt gate the
-- way `art_assets_pending_idx` is, so a binding that has never been tried sorts first if this ever
-- grows a walk.
create index track_audio_pending_idx on deadair.track_audio (next_attempt_at nulls first) where checksum is null;

-- Two bindings that turn out to be the same audio share one file on disk. Content addressing makes
-- that free; this is how anything looking at disk usage can tell.
create index track_audio_checksum_idx on deadair.track_audio (checksum) where checksum is not null;

-- migrate:down

drop table if exists deadair.track_audio;
