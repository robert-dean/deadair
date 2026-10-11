-- migrate:up

-- A party pass, and the guests who joined with one.
--
-- An operator starts a party and the station mints a token shown as a QR code. Whoever scans it joins
-- as a GUEST: an actor of its own kind, holding no platform role, that may search for a record, ask
-- for one and see what became of its own requests, and nothing else (the `requests.ask` policy). One
-- actor per guest is what lets the request arbiter's "one at a time" hold for each of them, since it
-- counts by the requester's key.
--
-- The token itself is never stored in the clear. `token_hash` is how a join finds the pass;
-- `token_sealed` is the same token encrypted with the station's root key, so the console can show the
-- QR code again for as long as the party runs. A pass is live while `ended_at` is null and
-- `expires_at` has not passed; every guest request checks that, so ending a party or letting it run
-- out turns every guest away on their next request.
alter table deadair.actors drop constraint actors_type_check;
alter table deadair.actors add constraint actors_type_check check (type in ('user', 'system', 'vendor', 'guest'));

create table deadair.party_passes (
    id uuid primary key default gen_random_uuid(),
    created_at timestamptz not null default now(),
    created_by uuid references deadair.actors (id) on delete set null,
    token_hash text not null unique,
    token_sealed text not null,
    expires_at timestamptz not null check (expires_at > created_at),
    ended_at timestamptz
);

create table deadair.party_guests (
    actor_id uuid primary key references deadair.actors (id) on delete cascade,
    pass_id uuid not null references deadair.party_passes (id) on delete cascade,
    joined_at timestamptz not null default now()
);
create index party_guests_pass_idx on deadair.party_guests (pass_id);

-- migrate:down

drop table deadair.party_guests;
drop table deadair.party_passes;
delete from deadair.actors where type = 'guest';
alter table deadair.actors drop constraint actors_type_check;
alter table deadair.actors add constraint actors_type_check check (type in ('user', 'system', 'vendor'));
