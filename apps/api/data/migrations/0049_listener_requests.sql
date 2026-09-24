-- migrate:up

-- A record somebody listening asked the station to play.
--
-- From a listener app (a signed-in account) or a chat platform (a person the station knows only by the
-- platform's id), and one table for both, because the arbitration is the same whoever is asking: one
-- open request per person, a cooldown, a cap on how many are waiting at once. See
-- `docs/internals/messaging.md` § "Requests".
--
-- **A row is a request, never a running order.** Placing one posts `insertRequested` to the director,
-- which remains the only writer of what airs; this table says only what was asked, by whom, and what
-- became of it.
--
-- `status` walks one way:
--   waiting   the operator has asked to approve requests, and nobody has yet
--   pending   approved (or needing no approval) and not yet in the order: its audio is being
--             fetched, or there was no quiet place near the head of the order a moment ago
--   queued    in the running order
--   aired     heard
--   declined  refused, by the rules or by an operator; `reason` says why in the station's words
--   expired   never placed, or placed and never heard, within the time the station gives it
create table deadair.listener_requests (
    id uuid not null default gen_random_uuid() primary key,
    station_key text not null default 'main',
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    -- Who asked, as one key the cooldown and the one-at-a-time rule compare on: `user:<actor id>`
    -- for an account, `chat:<plugin id>:<platform user id>` for somebody on a chat platform.
    requester_key text not null,
    -- What to call them. Whatever the account or the platform said; never used as a key.
    requester_name text not null,
    -- The account, when there is one. Set null rather than cascaded: a request that aired is part of
    -- what the station did whoever has since left.
    actor_id uuid references deadair.actors (id) on delete set null,
    -- Where to tell somebody on a chat platform what became of it. All four absent for an app.
    plugin_id text,
    chat_id text,
    chat_kind text check (chat_kind in ('direct', 'group')),
    message_id text,
    -- The record, and what it was called when it was asked for, so the list still reads after the
    -- catalog renames or merges it. Cascaded: a request for a record the catalog no longer holds is
    -- a request for nothing.
    track_id uuid not null references deadair.tracks (id) on delete cascade,
    title text not null,
    artist text not null,
    status text not null default 'pending' check (status in ('waiting', 'pending', 'queued', 'aired', 'declined', 'expired')),
    -- Why it was declined or expired, in the station's own words or an operator's. NEVER anything
    -- the listener wrote.
    reason text,
    decided_at timestamptz,
    aired_at timestamptz
);

-- The arbitration's reads: what is open or recent for one person, and what is open station-wide.
create index listener_requests_requester_idx on deadair.listener_requests (station_key, requester_key, created_at desc);
create index listener_requests_status_idx on deadair.listener_requests (station_key, status, created_at);

select deadair.add_updated_at_trigger('deadair.listener_requests');

-- migrate:down

drop table if exists deadair.listener_requests;
