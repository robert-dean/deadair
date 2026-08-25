-- migrate:up

-- `first_enabled_at` is when the operator first turned this plugin on, and it exists to be asked one
-- question: has this one ever been trusted before.
--
-- Enabling a plugin is the moment trust is extended, because a plugin runs in this process with this
-- process's own privileges, so the console asks first. Asking on EVERY enable is a different claim
-- and a wrong one: it says the answer was never recorded, when the operator has already given it.
--
-- It records a FACT rather than a consent, which is why it is spelled for what happened rather than
-- `trusted_at`. Nothing here can be withdrawn: disabling a plugin leaves the column alone, since
-- turning something off is not a statement that you never trusted it, and a plugin re-enabled a year
-- later is one the operator already knows what they are agreeing to.
create table deadair.plugin_configs (
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now() check (updated_at >= created_at),
    plugin_id text primary key,
    enabled boolean not null default false,
    first_enabled_at timestamptz,
    config jsonb not null default '{}',
    secrets jsonb not null default '{}',
    status text,
    last_error text,
    log_level text not null default 'warn' check (log_level in ('debug', 'info', 'warn', 'error'))
);
select deadair.add_updated_at_trigger('deadair.plugin_configs');

create table deadair.plugin_storage (
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now() check (updated_at >= created_at),
    plugin_id text not null,
    key text not null,
    value jsonb,
    primary key (plugin_id, key)
);
select deadair.add_updated_at_trigger('deadair.plugin_storage');

-- What the operator answered when a plugin asked for a capability.
--
-- The rest of a manifest's permissions are disclosure: a plugin states what it reaches and the host
-- holds it to that, with nobody asked anything. `permissions.grants` is the other kind — a
-- capability wide enough that a person decides, per install — and this is where the decision lives.
--
-- **Only decisions are stored, and only an allowance changes anything.** There is no record of the
-- asking, because the manifest IS the request: the host reads it on every discovery, so a row saying
-- "this plugin asked" would be a second writer of one fact, going stale the moment a plugin's
-- manifest changed and leaving a capability enabled by a row nobody can see.
--
-- Denied is the DEFAULT, so a `denied` row and no row at all are the same answer and nothing reads
-- the difference. The row still earns its place: it records who refused and when, which an absence
-- cannot. What the table deliberately does NOT support is a third "not yet answered" state — a
-- console able to tell that from a refusal would have to flag both, and a permission surface that
-- nags about settled decisions is one nobody reads.
--
-- `capability` is the HOST's vocabulary rather than free text (see `plugin.grants.ts`), and it is
-- deliberately not a foreign key to anything: a capability is code, not data, and a row for one the
-- host has since retired should be ignored rather than block a deploy.
--
-- `decided_by` is nullable and set null on delete, like `station_events.actor_id`: who said yes is
-- worth keeping and is not worth keeping an actor row alive for.
create table deadair.plugin_grants (
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now() check (updated_at >= created_at),
    plugin_id text not null,
    capability text not null,
    decision text not null check (decision in ('allowed', 'denied')),
    decided_at timestamptz not null default now(),
    decided_by uuid references deadair.actors (id) on delete set null,
    primary key (plugin_id, capability)
);
select deadair.add_updated_at_trigger('deadair.plugin_grants');

-- migrate:down

drop table if exists deadair.plugin_grants;
drop table if exists deadair.plugin_storage;
drop table if exists deadair.plugin_configs;
