-- migrate:up

-- The people on a slot besides its host: a GUEST HOST who sits in on some nights, and (later) the
-- CO-HOSTS who present beside the host.
--
-- Rows with foreign keys rather than a list of ids on the slot, on the argument `clock_bands` and
-- `caller_hosts` already make: a row can carry a foreign key, so deleting a persona or a slot takes
-- its rows with it instead of leaving an id that names nobody. Both ends cascade.
--
-- A row says WHEN it applies in one of three ways:
--
--   * always:  no `days` and no `every_n`. Only meaningful for a co-host; the service refuses it for
--              a guest host, who by definition is not on every night.
--   * fixed:   `days`, the weekdays it applies on (Sunday 0), as `schedule_slots.days` holds them.
--   * random:  `every_n`, the average number of the slot's occurrences between appearances (7 is
--              about one night in seven), and `cooldown_days`, the fewest calendar days between two.
--              Absent is half of `every_n`. The roll is a pure function of the slot, the person and
--              the date (`director/slot.visits.ts`), so nothing about it is stored and nothing
--              re-rolls: the tick, the timetable and the console all get the same answer for a night.
create table deadair.schedule_slot_hosts (
    id uuid primary key default gen_random_uuid(),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    slot_id uuid not null references deadair.schedule_slots (id) on delete cascade,
    persona_id uuid not null references deadair.personas (id) on delete cascade,
    role text not null constraint schedule_slot_hosts_role_check check (role in ('guest', 'cohost')),
    -- Row order within a role, which is precedence: the first guest whose night it is takes it.
    position integer not null default 0,
    days jsonb,
    every_n integer constraint schedule_slot_hosts_every_n_check check (every_n is null or every_n between 2 and 366),
    cooldown_days integer constraint schedule_slot_hosts_cooldown_check check (cooldown_days is null or cooldown_days between 0 and 366),
    constraint schedule_slot_hosts_when_check check (days is null or every_n is null),
    constraint schedule_slot_hosts_cooldown_random check (cooldown_days is null or every_n is not null),
    constraint schedule_slot_hosts_check check (updated_at >= created_at),
    constraint schedule_slot_hosts_unique unique (slot_id, persona_id, role)
);

create index schedule_slot_hosts_slot_idx on deadair.schedule_slot_hosts (slot_id, role, position);

select deadair.add_updated_at_trigger('deadair.schedule_slot_hosts');

-- What the running order needs to know about WHICH night of a slot it is.
--
-- `slot_occurrence` is the date the occurrence it was placed for began on. The slot id alone cannot
-- say it, because a slot that runs straight through midnight into the next day's run is the same id
-- on both nights, and a guest host on the second night has to take over at its start.
--
-- `regular_persona_id` is who USUALLY presents the slot, set only while a guest host is sitting in,
-- so the guest can say whose show it is. Null is the ordinary state. It cascades to null for the
-- reason `persona_id` does: a deleted host is not a reason for the broadcast to fail.
alter table deadair.station_lineup
    add column slot_occurrence date,
    add column regular_persona_id uuid references deadair.personas (id) on delete set null;

-- migrate:down

alter table deadair.station_lineup drop column regular_persona_id, drop column slot_occurrence;
drop table deadair.schedule_slot_hosts;
