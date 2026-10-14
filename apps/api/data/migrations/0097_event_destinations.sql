-- migrate:up

-- Where the station sends what happens on it: an operator's own server (a home automation hub, a
-- workflow tool) that wants a signed POST when a record starts, a break goes on, a request arrives.
--
-- These are EVENT DESTINATIONS, and the naming is deliberate on both sides. An event is the moment
-- itself (`track.started`); a destination is where it goes; and today every destination is an HTTP
-- webhook, which is why there is no `kind` column yet. A second transport adds one on the day it
-- lands. "Webhooks" in this codebase means the other direction, a platform pushing INTO the station,
-- under `/webhooks/*`. And none of this is `station_events`, which is the activity feed's record of a
-- moment written for a person to read.
--
-- The secret signs every delivery, so it has to be readable again and cannot be a hash. It is sealed
-- with the station's root key, on the party pass's rule (0085), and shown to the operator in the
-- clear only when it is minted.
create table deadair.event_destinations (
    id uuid primary key default gen_random_uuid(),
    -- Present for the reason it is on every other station-owned table.
    station_key text not null default 'main',
    name text not null check (length(name) between 1 and 200),
    -- An operator's instruction, and allowed to be a LAN address: see `webhookUrlProblem` for the
    -- rule, and for why a redirect is what is refused instead.
    url text not null,
    secret_sealed text not null,
    -- Off means nothing is sent. Turning it back on is the operator's, and nothing else's, to do.
    enabled boolean not null default true,
    -- Who made it. Set null rather than cascading: a destination keeps receiving after the account
    -- that added it is removed, until somebody deletes it.
    created_by uuid references deadair.actors (id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index event_destinations_station_idx on deadair.event_destinations (station_key, created_at);

-- Every attempt to deliver an event to a destination, test deliveries included, and what came of it.
--
-- A log for the console, not a queue: retries are the job broker's, and nothing reads this to decide
-- whether to send. It is kept SHORT, to the newest fifty per destination, trimmed as each row is
-- written, because what an operator needs is "what has it been doing lately" and a busy station
-- would otherwise write one row per record per destination forever.
--
-- `error` is the station's own sentence about what went wrong, never the receiver's response body,
-- which is somebody else's text.
create table deadair.event_deliveries (
    id uuid primary key default gen_random_uuid(),
    destination_id uuid not null references deadair.event_destinations (id) on delete cascade,
    -- The envelope's id, which a retry keeps, so the attempts at one event can be counted.
    event_id uuid not null,
    event_type text not null,
    attempt integer not null default 1 check (attempt >= 1),
    outcome text not null check (outcome in ('delivered', 'failed', 'dropped')),
    http_status integer,
    duration_ms integer not null default 0 check (duration_ms >= 0),
    error text,
    created_at timestamptz not null default now()
);

create index event_deliveries_destination_idx on deadair.event_deliveries (destination_id, created_at desc);
create index event_deliveries_event_idx on deadair.event_deliveries (destination_id, event_id);

-- migrate:down

drop table deadair.event_deliveries;
drop table deadair.event_destinations;
