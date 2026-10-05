-- migrate:up

-- Whether each judgement was made with the record's lyric in front of the model.
--
-- A judgement is only re-made when its instructions change, so one made before the lyric arrived kept
-- whatever the model had then for good: a search result at best, and its own memory when the search
-- found nothing. Live, the first subject pass ran before the first lyrics pass and wrote fifteen of
-- seventeen subjects from memory alone. A row judged without words is now stale once words exist,
-- which the lyric is: the prompt already tells the model to trust it over a page about the song.
--
-- False by default, so every row judged before this column existed is treated as judged without words
-- and is re-made the first time the walk finds a lyric for it. A record that never gets one keeps its
-- judgement, which is the right answer for an instrumental and the only one for a record no source has.
alter table deadair.track_lyric_labels
    add column moods_from_words boolean not null default false,
    add column subject_from_words boolean not null default false;

-- migrate:down

alter table deadair.track_lyric_labels
    drop column moods_from_words,
    drop column subject_from_words;
