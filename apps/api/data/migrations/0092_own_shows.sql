-- migrate:up

-- A show the station makes for itself: a saved recipe for a podcast, kept beside the shows it carries
-- from somebody else's feeds on the Podcasts page.
--
-- Every episode is a production, made, joined and aired by the code that already does all three, so
-- this table holds only what is the same from one episode to the next: what the show is called, who
-- presents it, how long it runs, how much of the model it is worth, and what it is about when an
-- episode is asked for with no subject of its own. "Wind-down" at bedtime and "News in depth" over the
-- washing up are two rows.
--
-- Not `station_shows`: a `StationShow` is already somebody else's programme the station carries, as a
-- podcast plugin describes it, and two things called a station show would be one name for opposite
-- ideas.
create table deadair.own_shows (
    id uuid not null default gen_random_uuid() primary key,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now() check (updated_at >= created_at),
    station_key text not null default 'main',
    -- What the show is called, which is what each episode's title starts with.
    title text not null check (length(title) > 0),
    -- What the show is, in the operator's words, for the console. Never read out.
    description text,
    -- What an episode is about when nobody gives it a subject of its own: the brief every such
    -- episode is commissioned with.
    subject text,
    -- Who presents it. Null is whoever is presenting when a pass runs, as it is for any production.
    persona_id uuid references deadair.personas (id) on delete set null,
    -- How long an episode runs. Null is the station's production length.
    target_ms integer check (target_ms is null or target_ms > 0),
    -- How much of the model an episode is worth. Null is the station's default.
    writing_mode text constraint own_shows_writing_mode_check check (writing_mode is null or writing_mode in ('quick', 'outlined', 'polished'))
);

select deadair.add_updated_at_trigger('deadair.own_shows');

create index own_shows_station_idx on deadair.own_shows (station_key, title);

-- Which show an episode belongs to. Set null rather than cascading when a show is deleted, because an
-- episode that aired still aired, and the production row is the record of it.
alter table deadair.productions add column show_id uuid references deadair.own_shows (id) on delete set null;

create index productions_show_idx on deadair.productions (show_id, created_at desc) where show_id is not null;

-- migrate:down

drop index if exists deadair.productions_show_idx;
alter table deadair.productions drop column show_id;
drop table deadair.own_shows;
