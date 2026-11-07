-- migrate:up

-- Which shows a library recording belongs to: a show's own sponsor spot, a presenter's own ident.
--
-- A recording with no rows here is the station's, and airs on every show, which is every recording
-- that existed before this table did. A row names EITHER a slot (the show, whoever presents it
-- tonight) OR a persona (the presenter, whichever show they are on), never both, and a recording
-- matches when ANY of its rows names what is on air: a slot's sponsor spot still plays the night a
-- guest host sits in.
--
-- Rows with foreign keys rather than a list of ids on the segment, on the argument
-- `schedule_slot_hosts` makes: deleting a slot or a persona takes its rows with it instead of leaving
-- an id that names nobody. All three ends cascade.
create table deadair.segment_scopes (
    id uuid primary key default gen_random_uuid(),
    created_at timestamptz not null default now(),
    segment_id uuid not null references deadair.segments (id) on delete cascade,
    slot_id uuid references deadair.schedule_slots (id) on delete cascade,
    persona_id uuid references deadair.personas (id) on delete cascade,
    constraint segment_scopes_one_target check ((slot_id is null) <> (persona_id is null))
);

create unique index segment_scopes_slot_unique on deadair.segment_scopes (segment_id, slot_id) where slot_id is not null;
create unique index segment_scopes_persona_unique on deadair.segment_scopes (segment_id, persona_id) where persona_id is not null;

-- Whether this recording was ever given a scope, which the rows alone cannot say once the cascade
-- has taken them. A recording scoped to one show whose slot was then deleted has no rows left, and
-- without this it would read as a recording for every show and air on all of them. With it, it reads
-- as scoped to nothing and airs nowhere until an operator scopes it again or clears it.
alter table deadair.segments add column show_scoped boolean not null default false;

-- migrate:down

alter table deadair.segments drop column show_scoped;
drop table deadair.segment_scopes;
