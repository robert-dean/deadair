-- migrate:up

-- The episodes of somebody else's programmes that this station knows about, and what it has done
-- with each: whether it has fetched the audio, and whether it has aired it.
--
-- The station's own table rather than anything a plugin keeps, because every column past the
-- description is a fact about the STATION. A podcast plugin says what a feed published; it cannot
-- know that this station fetched episode 12 on Tuesday and aired it at nine, and a plugin asked to
-- remember it would be holding station state in a plugin's storage, where a reinstall loses it and
-- nothing else can read it.
--
-- One row per episode per station, keyed by the show and the plugin's own id for the episode. That
-- id is a de-duplication contract on the capability (`capabilities/podcast.ts`), which is what makes
-- a refresh an upsert: the same episode listed every half hour is one row, re-described.
--
-- Rows are kept when a feed stops listing them. A feed carries the newest few dozen episodes and
-- drops the rest as it grows, and an episode that aired last month has not stopped having aired.
create table deadair.podcast_episodes (
    id uuid not null default gen_random_uuid() primary key,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now() check (updated_at >= created_at),
    station_key text not null default 'main',
    -- The show, as the host qualifies it: the plugin's id, a colon, the plugin's own id for the show
    -- (`deadair.podcast:73b7fb89`). Text and not a reference, for `track_sources.plugin_id`'s reason:
    -- shows arrive from plugins, and the schema must not need a migration to learn one.
    show_id text not null,
    -- The plugin's own id for the episode. Stable across calls by contract.
    episode_id text not null,

    -- What the feed said, as of the last time a refresh read it. Re-written by every refresh, because
    -- a publisher correcting a title or a summary is the publisher's right and the station should say
    -- the corrected one.
    show_title text not null,
    title text not null,
    -- Plain text, never markup: a presenter introducing the episode reads from this.
    summary text,
    -- The episode's page, for a person.
    url text,
    published_at timestamptz,
    -- How long the PUBLISHER says it runs. The only length the station has before the bytes arrive,
    -- so it is what an episode is planned against, and null when the feed made no claim.
    duration_ms integer constraint podcast_episodes_duration_check check (duration_ms is null or duration_ms > 0),
    -- Where the audio is, as the feed gave it. Fetched by the station itself, once, ahead of the slot.
    audio_url text not null,
    -- The publisher's claims about the file. Claims: the station decides what it holds from the bytes
    -- it receives. An `integer`, as `track_audio.byte_size` is: a claimed size past two gigabytes is not
    -- an episode, and the refresh drops the claim rather than storing it.
    audio_mime text,
    audio_bytes integer constraint podcast_episodes_audio_bytes_check check (audio_bytes is null or audio_bytes > 0),
    artwork_url text,
    -- Null is "the publisher did not say", which is not clean.
    explicit boolean,
    -- When a refresh last saw this episode in its feed.
    seen_at timestamptz not null default now(),

    -- The station's own copy, once it has one: a `syndicated` segment holding the audio. Set null
    -- rather than cascading if the segment goes, because the episode is still an episode and the
    -- station can fetch it again.
    segment_id uuid references deadair.segments (id) on delete set null,
    -- When a fetch of the audio was last ASKED for, which is what keeps asking idempotent: the
    -- scheduler claims the row by moving this forward, and a fetch that died without a word is asked
    -- for again once it is old enough, rather than being a state some row is stuck in forever.
    fetch_requested_at timestamptz,
    -- How many fetches have failed in a row, and why the last one did. Cleared by a success.
    fetch_attempts integer not null default 0 constraint podcast_episodes_fetch_attempts_check check (fetch_attempts >= 0),
    fetch_error text,
    -- The slot the station fetched it for, so the console can say "wanted at nine" beside a fetch.
    scheduled_for timestamptz,
    -- When a listener could first have heard it. An episode is aired once; this is what says so.
    aired_at timestamptz,

    constraint podcast_episodes_episode_unique unique (station_key, show_id, episode_id)
);

select deadair.add_updated_at_trigger('deadair.podcast_episodes');

-- The two reads everything here makes: a show's episodes newest first (the console, and the
-- scheduler asking for the newest one not yet aired), and the station's across every show.
create index podcast_episodes_show_idx on deadair.podcast_episodes (station_key, show_id, published_at desc nulls last, id);
create index podcast_episodes_newest_idx on deadair.podcast_episodes (station_key, published_at desc nulls last, id);

-- Which episode a segment is, from the segment's side: the director marks an episode aired from
-- the segment it just played.
create index podcast_episodes_segment_idx on deadair.podcast_episodes (segment_id) where segment_id is not null;

-- migrate:down

drop table deadair.podcast_episodes;
