-- migrate:up

-- A third kind of persona: the station's newsreader.
--
-- Until now a bulletin was written from whoever was presenting and spoken in their voice, so a pirate
-- captain read the headlines as the pirate, and a station that wanted that and a station that did
-- not could not say which it was. A newsreader is a persona of its own kind: the news is read in its
-- character and its voice whoever is hosting, and a station with no newsreader is unchanged.
--
-- 0012 left this list waiting for exactly this kind. Dropped and re-added rather than altered, for
-- 0040's reason; adding a value only widens what passes, so nothing existing is rejected.
alter table deadair.personas drop constraint personas_kind_check;

alter table deadair.personas
    add constraint personas_kind_check
    check (kind in ('host', 'caller', 'newsreader'));

-- One newsreader per station, enforced here rather than by convention, because two would be a choice
-- no bulletin could make the same way twice. Its own index rather than the default-host one widened
-- to `(station_key, kind)`: the newsreader is not a station's DEFAULT of anything, it is the only
-- one, so it carries no flag to switch and there is nothing for an operator to forget to set.
--
-- `personas_caller_not_default_check` (`not (default_host and kind <> 'host')`) already keeps a
-- newsreader from ever being the station's host, without a word changed.
create unique index personas_one_newsreader_idx on deadair.personas (station_key) where kind = 'newsreader';

-- migrate:down

-- A newsreader has nowhere to go in the narrower list. Its rows go, which takes its bulletins'
-- `persona_id` with them (`on delete set null`), and the next bulletin is read by the host.
delete from deadair.personas where kind = 'newsreader';

drop index deadair.personas_one_newsreader_idx;

alter table deadair.personas drop constraint personas_kind_check;

alter table deadair.personas
    add constraint personas_kind_check
    check (kind in ('host', 'caller'));
