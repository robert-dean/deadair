-- migrate:up

-- A persona is one character with any combination of jobs, rather than one job per character.
--
-- `kind` said what a character was FOR, and only one thing: a host could not also drop by somebody
-- else's show, so a station that wanted that wrote the character twice, with two sheets, two notebooks
-- and one voice mapped twice, and the two drifted. `kinds` is the set of things this character may be
-- cast as, and the rules that read `kind` read whether the set holds the value instead.
--
-- A closed array rather than a flag per kind, so a new kind is one more value on the list and one more
-- rule in the code, exactly as it was for `kind`. Spelled as `0072`'s placements are: never empty,
-- since a character nobody may cast is a row with no meaning, and only values the code knows.
--
-- `kind` stays, written as the first of `kinds` the code ranks highest (`primaryKind`), so a client
-- built before this reads the answer it always did. It goes in a later migration, once every released
-- app reads `kinds`.
alter table deadair.personas
    add column kinds text[] not null default array['host']::text[] constraint personas_kinds_check check (
        cardinality(kinds) > 0 and kinds <@ array['host', 'caller', 'newsreader', 'guest']::text[]
    );

update deadair.personas set kinds = array[kind];

-- Still one newsreader per station, whatever else the newsreader is.
drop index deadair.personas_one_newsreader_idx;
create unique index personas_one_newsreader_idx on deadair.personas (station_key) where 'newsreader' = any(kinds);

-- The station's own host must be able to present, whatever else it can do.
alter table deadair.personas drop constraint personas_caller_not_default_check;
alter table deadair.personas
    add constraint personas_caller_not_default_check check (not (default_host and not ('host' = any(kinds))));

-- migrate:down

-- `kind` was kept current all along, so it already holds each character's highest-ranked kind. A
-- character that was also something else loses the rest, and a host that was also the newsreader is
-- the host again, so the next bulletin is read by whoever presents.
alter table deadair.personas drop constraint personas_caller_not_default_check;
alter table deadair.personas
    add constraint personas_caller_not_default_check check (not (default_host and kind <> 'host'));

drop index deadair.personas_one_newsreader_idx;
create unique index personas_one_newsreader_idx on deadair.personas (station_key) where kind = 'newsreader';

alter table deadair.personas drop column kinds;
