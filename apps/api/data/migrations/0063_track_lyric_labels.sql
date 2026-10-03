-- migrate:up

-- What the station has DERIVED about a record from its lyric, and from what the web says about it.
--
-- The labels are the durable artifact and the lyric is not: what the rest of the station reads is
-- here, and `track_lyrics` is only ever read to produce it. One row per record, because a judgement
-- is the station's own, made once from whatever it had, rather than one source's answer among several.
--
-- `moods` is the WHOLE distribution over the seven moods, never the top one: the single label read
-- off a lyric is wrong most of the time, and what makes it usable is how much of its weight a record
-- gives the mood wanted. See `lyrics/lyric.moods.ts`.
--
-- `moods_version` is the trick `track_analysis.schema_version` uses: a row judged under older
-- instructions reads as STALE rather than as missing, so judging the library again under better ones
-- is an ordinary pass rather than a migration. A row the model judged and could not place has a
-- version and no moods, which is `fact_extractions`' lesson: a judgement that produced nothing has to
-- be recorded as made, or the walk asks the same question about the same record every quarter hour.
create table deadair.track_lyric_labels (
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now() check (updated_at >= created_at),
    track_id uuid not null primary key references deadair.tracks (id) on delete cascade,
    -- `{ "love": 0.1, "happiness": 0.0, ... }`, summing to 1. Null for a record that was judged and
    -- could not be placed, and for one that has only ever failed.
    moods jsonb,
    -- Which instructions the moods were judged under. Null until a judgement has been made.
    moods_version text,
    moods_at timestamptz,
    -- A remembered failure: the model could not be reached, or answered nothing readable. Retried on
    -- a doubling backoff from `moods_retry_at`, and cleared by the next judgement.
    moods_attempts integer not null default 0,
    moods_retry_at timestamptz,
    moods_error text
);
select deadair.add_updated_at_trigger('deadair.track_lyric_labels');

-- migrate:down

drop table if exists deadair.track_lyric_labels;
