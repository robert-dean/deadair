-- migrate:up

-- A main genre the station's model named for a band its enrichment gives none.
--
-- A show's mix flow splits and counts records by their band's main genre, the first genre the artist's
-- enrichment lists, and about one artist in seven on the live station has none (587 of 4205 on
-- 2026-11-17). Those records matched no genre branch, so a black metal band nobody had tagged went
-- down "everything else" and past the show's black metal limit. The model is asked once per band and
-- the answer kept, beside the enrichment rather than in it: enrichment is what providers say, and this
-- is the station's own judgement, which never overrides a provider's genre and only fills a gap.
--
-- `genre` null with a `judged_at` is a band the model could not place, kept so it is not asked again
-- until the instructions change (`version`). A failure backs off through `retry_after`.
create table deadair.artist_genre_judgements (
    artist_id uuid primary key references deadair.artists (id) on delete cascade,
    genre text constraint artist_genre_judgements_genre_check check (genre is null or length(btrim(genre)) between 1 and 100),
    version text not null,
    judged_at timestamptz,
    failures integer not null default 0,
    last_error text,
    retry_after timestamptz,
    updated_at timestamptz not null default now()
);

-- migrate:down

drop table deadair.artist_genre_judgements;
