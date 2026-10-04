-- migrate:up

-- Where a record sits on its album, so the station can play an album in the order it was made.
--
-- Both nullable and both about the row's own `album_id`: the same recording is track 3 on the album
-- and track 14 on a compilation, and a row names one album. Ingest fills them only from a copy whose
-- album is the row's album, and only while they are blank, which is how every other field a provider
-- describes is filled here. Counted from 1, the way a tag counts; a zero is a tag nobody filled in and
-- never reaches the column.
--
-- Numbered 0062 rather than 0061 because the newsreader's migration took that number on another
-- branch. dbmate applies any version it has not recorded, in order, so the two can land either way
-- round.
alter table deadair.tracks
    add column track_number smallint constraint tracks_track_number_check check (track_number is null or track_number > 0),
    add column disc_number smallint constraint tracks_disc_number_check check (disc_number is null or disc_number > 0);

-- migrate:down

alter table deadair.tracks
    drop column disc_number,
    drop column track_number;
