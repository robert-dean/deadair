-- migrate:up

-- A music festival the station can build a show around: its name, its dates, where it is, and who is
-- on the bill. Everything a presenter may say about it is read from here, so a festival's dates are a
-- stored fact an operator typed or checked rather than something a service answered at break time.
-- `docs/internals/programming.md` and `breaks.md` say what reads it.
create table deadair.festivals (
    id uuid primary key default gen_random_uuid(),
    -- Present for the reason it is on every other station-owned table.
    station_key text not null default 'main',
    -- Said on air as written: "Shaky Knees", "the Newport Folk Festival".
    name text not null constraint festivals_name_check check (length(btrim(name)) between 1 and 120),
    -- Inclusive, on the festival's own calendar, which for a festival near the station is the station's.
    starts_on date not null,
    ends_on date not null,
    -- Where it is, as a presenter would say it: "Piedmont Park, Atlanta". Absent says nothing about where.
    place text constraint festivals_place_check check (place is null or length(btrim(place)) between 1 and 200),
    -- The festival's own page. Kept as where the facts came from, and never read out.
    url text constraint festivals_url_check check (url is null or length(url) between 1 and 2000),
    -- Where an import came from, as the plugin and its own id for the event. Both absent for one an
    -- operator typed. Nothing re-reads the source: an import is a starting point the operator edits.
    source_plugin_id text,
    source_event_id text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    constraint festivals_dates_ordered check (starts_on <= ends_on),
    constraint festivals_source_paired check ((source_plugin_id is null) = (source_event_id is null))
);

create index festivals_station_starts_idx on deadair.festivals (station_key, starts_on);

select deadair.add_updated_at_trigger('deadair.festivals');

-- Who is on the bill, in the order the operator listed them. Rewritten whole on every save, since a
-- lineup is edited as one list and a diff of it would be a second writer's worth of rules.
create table deadair.festival_acts (
    festival_id uuid not null references deadair.festivals (id) on delete cascade,
    position integer not null,
    -- As the station credits them, which is the name a presenter says and the name searched for records.
    artist text not null constraint festival_acts_artist_check check (length(btrim(artist)) between 1 and 200),
    -- The day they play, when the bill says. Inside the festival's dates, which the service checks.
    day date,
    headliner boolean not null default false,

    primary key (festival_id, position)
);

-- migrate:down

drop table if exists deadair.festival_acts;
drop table if exists deadair.festivals;
