-- migrate:up

create table deadair.artists (
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now() check (updated_at >= created_at),    
    id uuid not null default gen_random_uuid() primary key,
    artist_key text not null unique,
    name text not null,
    rating integer not null default 0 constraint artists_rating_check check (rating in (-1, 0, 1))
);
select deadair.add_updated_at_trigger('deadair.artists');

create table deadair.albums (
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now() check (updated_at >= created_at),        
    id uuid not null default gen_random_uuid() primary key,
    artist_id uuid not null references deadair.artists (id),
    name text not null,
    name_key text not null,
    year integer,
    cover_art_id text,
    rating integer not null default 0 constraint albums_rating_check check (rating in (-1, 0, 1))
);
select deadair.add_updated_at_trigger('deadair.albums');
create unique index albums_artist_name_key_idx on deadair.albums (artist_id, name_key);

create table deadair.tracks (
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now() check (updated_at >= created_at),        
    id uuid not null default gen_random_uuid() primary key,
    artist_id uuid not null references deadair.artists (id),
    album_id uuid references deadair.albums (id),
    source text not null,
    source_id text not null,
    artists text not null,
    title text not null,
    title_key text not null,
    genre text,
    year integer,
    duration_ms integer,
    cover_art_id text,
    rating integer not null default 0 constraint tracks_rating_check check (rating in (-1, 0, 1)),
    last_seen_at timestamptz,
    missing_at timestamptz
);
select deadair.add_updated_at_trigger('deadair.tracks');
create unique index tracks_source_id_idx on deadair.tracks (source, source_id);
create index tracks_artist_title_key_idx on deadair.tracks (artist_id, title_key);
create index tracks_title_key_idx on deadair.tracks (title_key);

create table deadair.playlists (
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now() check (updated_at >= created_at),        
    id uuid not null default gen_random_uuid() primary key,    
    name text not null,
    prompt text not null default ''
);
select deadair.add_updated_at_trigger('deadair.playlists');

create table deadair.playlist_tracks (
    id uuid not null default gen_random_uuid() primary key,
    playlist_id uuid not null references deadair.playlists (id),
    track_id uuid not null references deadair.tracks (id),
    position integer not null,
    constraint playlist_tracks_playlist_id_track_id_key unique (playlist_id, track_id),
    constraint playlist_tracks_playlist_id_position_key unique (playlist_id, position)
);


-- migrate:down

drop table deadair.playlist_tracks;
drop table deadair.playlists;
drop table deadair.tracks;
drop table deadair.albums;
drop table deadair.artists;