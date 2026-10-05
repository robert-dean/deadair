-- migrate:up

-- The words of a record, and the timings of its lines, as a `lyrics` plugin found them.
--
-- Read by the host and NEVER said. A lyric is somebody's copyrighted text in full, so nothing here
-- is served on the wire, extracted into `deadair.facts` or put in a prompt a deterministic writer
-- reads. What the station takes from a row is DERIVED from it: when the singing starts and stops
-- (from the timed lines), and later what the record is about and what mood it is in. The argument
-- is [track-lyrics](https://github.com/robert-dean/deadair/discussions/47), and
-- `packages/plugin-sdk/src/capabilities/lyrics.ts` states the rule a plugin author sees.
--
-- A table of its own rather than a field in `track_enrichment.data`, for four reasons that discussion
-- gives: the enrichment merge is last-wins by priority and a plain lyric from one source and a
-- synced one from another are two artifacts the station wants both of; enrichment payloads are
-- served to the console; the caps there do not fit a lyric; and a lyric, once right, is right
-- permanently, where enrichment is refreshed against a changing upstream.
--
-- ONE row per track per provider, exactly as `track_enrichment` is, and for the same reason: two
-- sources never overwrite each other and which one the station believes stays a read-time decision.
create table deadair.track_lyrics (
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now() check (updated_at >= created_at),
    id uuid not null default gen_random_uuid() primary key,
    track_id uuid not null references deadair.tracks (id) on delete cascade,
    -- Manifest id of the plugin that answered. A soft reference, as everywhere.
    provider text not null,
    -- Fetch provenance, not identity: the source's own id for what it matched.
    provider_ref text,
    -- The words without timings. Null on a miss, a failure and an instrumental.
    plain text,
    -- The timed lines, `[{ atMs, endMs?, text }]` in the order the source gave them. Null when the
    -- source had no timings, which is the "cannot say when the singing starts" case and must never
    -- be read as a start of zero.
    synced jsonb,
    -- The source said nobody sings on this record. An ANSWER rather than a miss: the walk stops
    -- asking, and a talk-up treats the record as one with nothing to talk over.
    instrumental boolean not null default false,
    -- A BCP 47 tag when the source stated one. Never guessed.
    language text,
    fetched_at timestamptz not null default now(),
    -- When to ask this provider again. NULL for a row that holds words or an instrumental, because
    -- a lyric once matched does not go stale the way a biography does: what gets re-run is the
    -- derivation over it, never the fetch. A miss and a failure carry a date, so a source that
    -- grows, or recovers, is asked again.
    expires_at timestamptz,
    -- A remembered failure, counted consecutively. See artist_enrichment.attempts.
    attempts integer not null default 0,
    last_error text,
    constraint track_lyrics_provider_key unique (track_id, provider),
    -- An instrumental carries no words, so a row cannot claim both.
    constraint track_lyrics_instrumental_check check (not instrumental or (plain is null and synced is null))
);
select deadair.add_updated_at_trigger('deadair.track_lyrics');

-- migrate:down

drop table if exists deadair.track_lyrics;
