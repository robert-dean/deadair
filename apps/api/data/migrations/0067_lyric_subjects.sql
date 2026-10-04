-- migrate:up

-- What a record is ABOUT, in one sentence of the station's own words, beside its judged moods.
--
-- The one label a presenter is shown, and so the one that could put somebody's lyric on air: it is
-- refused before it is stored if it shares a run of words with the lyric, and a break writer is shown
-- this and never the lyric. Versioned, failed and backed off on exactly the terms the moods are, and
-- separately from them, because the two walks are switched on separately and one failing says
-- nothing about the other.
alter table deadair.track_lyric_labels
    add column subject text,
    add column subject_version text,
    add column subject_at timestamptz,
    add column subject_attempts integer not null default 0,
    add column subject_retry_at timestamptz,
    add column subject_error text;

-- migrate:down

alter table deadair.track_lyric_labels
    drop column subject,
    drop column subject_version,
    drop column subject_at,
    drop column subject_attempts,
    drop column subject_retry_at,
    drop column subject_error;
