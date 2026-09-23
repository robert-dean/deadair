-- migrate:up

-- Which hosts a caller rings in to.
--
-- A caller used to be cast into any phone-in on the station, least recently heard first, so a
-- character written as one presenter's foil rang every other show as readily as theirs. A row here
-- says this caller rings in to this host, and `ProductionCaster` casts a caller only into a programme
-- presented by a host it names. A caller with no rows rings in to anybody, which is every caller
-- written before this migration and still the ordinary case: a tie is a RESTRICTION an operator
-- chose, not something every caller has to be given before it can be cast.
--
-- **Rows with foreign keys rather than a jsonb list on the persona**, for the reason `clock_bands`
-- stopped being a text box in 0017: a row cannot be malformed, and a row can carry a foreign key. A
-- list of ids on the sheet would go on naming a host that had been deleted, and every reader would
-- have to decide what that meant.
--
-- **Cascade at BOTH ends, and the host end is the one worth arguing.** Deleting a caller takes its
-- ties with it, which needs no argument. Deleting a host deletes the tie rather than the caller, and
-- a caller whose last tie went is untied — so it rings in to anybody again rather than to nobody.
-- That is the call `schedule_slots.persona_id` makes with `set null`: removing a persona drops what
-- pointed at it back to the station's ordinary behaviour, never takes it off the air. A caller that
-- silently stopped being cast because a host it once rang had been deleted is a character nothing on
-- any page would explain.
--
-- No `station_key`: both ends are personas, and a persona already belongs to one station.
--
-- **The kinds are not enforced here.** That `caller_id` is a caller and `host_id` a host would need a
-- composite key on `(id, kind)` at each end, which is a lot of schema to say what one service already
-- checks with a sentence an operator can read. `PersonasService` refuses a host that names hosts and a
-- caller that names anything but a host. The one thing a constraint can say cheaply, it says.
create table deadair.caller_hosts (
    caller_id uuid not null references deadair.personas (id) on delete cascade,
    host_id uuid not null references deadair.personas (id) on delete cascade,
    created_at timestamptz not null default now(),
    primary key (caller_id, host_id),
    constraint caller_hosts_distinct_check check (caller_id <> host_id)
);

-- The primary key answers "which hosts does this caller ring", which is what casting and the
-- console ask. This one is for the cascade when a host is deleted, which would otherwise scan.
create index caller_hosts_host_idx on deadair.caller_hosts (host_id);

-- migrate:down

drop table if exists deadair.caller_hosts;
