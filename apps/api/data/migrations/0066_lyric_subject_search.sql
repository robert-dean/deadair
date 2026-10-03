-- migrate:up

-- Finding records by what they are about, for the model choosing records (`search_music`'s `about`).
--
-- The `simple` configuration rather than a language's, because a subject is written in whatever
-- language the station's model answered in and stemming it as English would mangle the rest. It
-- matches words, not meanings: "leaving home" finds subjects that say leaving and home. That is
-- enough to be useful and honest about what it is; anything cleverer is an embedding, which is its
-- own piece of work.
create index track_lyric_labels_subject_search_idx on deadair.track_lyric_labels using gin (to_tsvector('simple', coalesce(subject, '')));

-- migrate:down

drop index if exists deadair.track_lyric_labels_subject_search_idx;
