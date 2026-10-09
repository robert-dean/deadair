-- migrate:up

-- A fourth kind of persona: a GUEST who drops by the studio for a short back-and-forth with the host.
--
-- Not a caller, whose whole premise is being somewhere else on a telephone, and not a host, because a
-- guest is on somebody else's show for a few minutes and never presents one. Everything a guest needs
-- from a persona (a sheet, a voice, a notebook, stories) a caller already had, so this is one value on
-- the list and the rules live in the code that casts and writes a visit (`production.cast.ts`).
--
-- Dropped and re-added rather than altered, for 0061's reason; adding a value only widens what passes.
-- `personas_caller_not_default_check` already keeps a guest from ever being the station's host.
alter table deadair.personas drop constraint personas_kind_check;

alter table deadair.personas
    add constraint personas_kind_check
    check (kind in ('host', 'caller', 'newsreader', 'guest'));

-- migrate:down

-- A guest has nowhere to go in the narrower list. Its rows go, which takes its beats' `persona_id`
-- with them (`on delete set null`).
delete from deadair.personas where kind = 'guest';

alter table deadair.personas drop constraint personas_kind_check;

alter table deadair.personas
    add constraint personas_kind_check
    check (kind in ('host', 'caller', 'newsreader'));
