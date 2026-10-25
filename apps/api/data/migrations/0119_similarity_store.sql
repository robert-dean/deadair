-- migrate:up

-- What the similarity sources have said, kept: who resembles an artist, and which records an artist
-- is known for.
--
-- `SimilarityService` held the first in a day-long map and asked for the second every time, which
-- was right while the only callers were a refill walking a handful of neighbours. It stopped being
-- right on a briefed show: The Church's brief names eighteen acts, the library holds 167 playable
-- records by them (none by three of them), 80 had aired inside the two-day repeat window on
-- 2026-10-25, and every refill asked the providers for the same three hits per act and had them
-- refused. A model handed a shortlist (`ModelSetGenerator`) needs a deep list of records per act it
-- can screen BEFORE choosing, and asking the providers for that on every refill, or again after
-- every deploy, is the cost this table removes.
--
-- Filled ON DEMAND and never by a walk of the library: every answer a caller already asks for is
-- written through, so the store grows with the artists the station actually airs and walks toward.
-- The one fill nobody asked for first is the acts a brief names, and that is capped per run
-- (`BriefActs`).
--
-- Names, never records the station holds. Nothing here airs or joins the library until
-- `PickResolver` resolves a pick, which is where the dislikes, the never-play rules and the rotation
-- rules live, so a similarity source cannot put anything on air that the operator forbade, and the
-- sync's missing sweep never sees a row of this.

-- One row per QUESTION asked of the sources, answered or not, so an artist nobody knows anything
-- about is not asked again on every refill. Written only when at least one source answered: an
-- outage is not remembered as "nobody resembles them".
create table deadair.similarity_asks (
    -- Whose answer this is: the operator's source order is per station, so the answer is too.
    station_key text not null default 'main',
    -- Which question: who resembles the artist, or which records they are known for.
    kind text not null constraint similarity_asks_kind_check check (kind in ('artists', 'records')),
    -- The artist asked about, as `normalizeKey` folds a name, which is how the service has always
    -- keyed its memory and how the rotation rules compare artists.
    artist_key text not null check (length(artist_key) > 0),
    -- The name as it was asked, for reading the table back.
    artist_name text not null,
    -- How many were asked for. A stored answer serves a later question only when it asked for at
    -- least as many, or came back with fewer than it asked for (which is the whole of what the
    -- source has).
    asked_limit integer not null check (asked_limit > 0),
    asked_at timestamptz not null default now(),

    primary key (station_key, kind, artist_key)
);

-- Who resembles an artist, in the merged order `SimilarityService.similarTo` answers with. Replaced
-- whole beside its `similarity_asks` row, in one transaction, which is why there is no foreign key:
-- the two are written together or not at all, and a key would only order the deletes.
create table deadair.similar_artists (
    station_key text not null default 'main',
    artist_key text not null,
    -- Position in the merged answer, from 0. The answer is replaced whole, so this is its order.
    rank integer not null check (rank >= 0),
    name text not null check (length(trim(name)) > 0),
    neighbour_key text not null,
    mbid text,
    -- The source's own score, comparable only inside one source's answer. Absent when it gave none.
    match double precision,
    -- The plugin id whose answer named this artist first.
    source text not null,

    primary key (station_key, artist_key, rank)
);

-- The records an artist is known for, in the order the one source that answered ranked them.
create table deadair.artist_records (
    station_key text not null default 'main',
    artist_key text not null,
    rank integer not null check (rank >= 0),
    title text not null check (length(trim(title)) > 0),
    -- The LEAD artist as the source wrote it, never a credit line: see `ArtistTrack.artist`.
    artist text not null check (length(trim(artist)) > 0),
    album text,
    year integer,
    -- The plugin id that answered.
    source text not null,

    primary key (station_key, artist_key, rank)
);

-- migrate:down

drop table deadair.artist_records;
drop table deadair.similar_artists;
drop table deadair.similarity_asks;
