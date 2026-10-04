-- migrate:up

-- Never-play rules: a KIND of record the station must not play, beside a dislike, which forbids one
-- thing. Ideas #22 is the design; `director/block.rules.ts` is what reads a row.
--
-- A rule is absolute and exclude-only: there is no "only these genres" here. Every scope is optional
-- and an absent one means "always", so an unscoped rule needs no null branch in the reader. Seeds
-- nothing: an empty table is a station with no rules, which is every station until somebody writes one.
--
create table deadair.block_rules (
    id uuid primary key default gen_random_uuid(),
    -- Present for the reason it is on every other station-owned table.
    station_key text not null default 'main',
    -- `genre` matches a tag that refines the value (`Punk Rock` under `Punk`); `tag` is exact.
    field text not null constraint block_rules_field_check check (field in ('genre', 'tag')),
    value text not null constraint block_rules_value_check check (length(btrim(value)) between 1 and 200),
    -- A season as two `MM-DD` days, wrapping the year end when `season_from > season_to`. Both or neither.
    season_from text constraint block_rules_season_from_check check (season_from ~ '^\d{2}-\d{2}$'),
    season_to text constraint block_rules_season_to_check check (season_to ~ '^\d{2}-\d{2}$'),
    -- Hours of the station's day, `from_hour <= hour < until_hour`, wrapping midnight. Both or neither.
    from_hour smallint constraint block_rules_from_hour_check check (from_hour between 0 and 23),
    until_hour smallint constraint block_rules_until_hour_check check (until_hour between 0 and 24),
    -- Station modes and schedule slots it is limited to. Empty means all of them.
    modes text[] not null default '{}',
    slot_ids text[] not null default '{}',
    -- When it stops holding. Null means until somebody removes it. A rule past it is ignored rather
    -- than deleted, so the console can still show what held yesterday.
    ends_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    constraint block_rules_season_pair_check check ((season_from is null) = (season_to is null)),
    constraint block_rules_hours_pair_check check ((from_hour is null) = (until_hour is null))
);

create index block_rules_station_idx on deadair.block_rules (station_key);

select deadair.add_updated_at_trigger('deadair.block_rules');

-- A lean, which is the opposite of a rule: the station favours these genres until `ends_at`, and can
-- still play anything else. It lives in the draw, never in the veto, so it can never leave the station
-- with nothing to play. One per station, and replacing it replaces the row.
create table deadair.genre_steers (
    station_key text primary key default 'main',
    genres text[] not null constraint genre_steers_genres_check check (cardinality(genres) between 1 and 20),
    ends_at timestamptz not null,
    created_at timestamptz not null default now()
);

-- migrate:down

drop table if exists deadair.genre_steers;
drop table if exists deadair.block_rules;
