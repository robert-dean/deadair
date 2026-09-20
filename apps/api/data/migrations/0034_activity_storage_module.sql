-- migrate:up

-- `storage` joins the console's filter axis, because something that deletes audio has to be able to
-- say so on the feed.
--
-- The sweep in `StorageService` removes media files no row points at any more, and an operator who
-- turned that switch on a month ago is owed the sight of it working rather than a disk figure that
-- quietly moved. None of the five existing values fits: one run spans the record cache, the cover art
-- and the spoken segments, so recording it as `playout` or `render` would be filing it under one of
-- the three stores it swept.
--
-- 0010 said, of this exact constraint, that "nothing has shipped, so a new value is an edit to this
-- line rather than a migration around it". That stopped being true, which is what this file is. The
-- constraint itself is still the right shape and the reasoning behind it has not changed: free text
-- would let a typo'd producer write a value the console's filter silently never matches.
--
-- Dropped and re-added rather than altered, because Postgres has no `alter constraint` for a check
-- body. No table rewrite: adding a value only widens what passes, so every existing row already
-- satisfies the new form and the validation scan finds nothing to reject.
alter table deadair.station_events drop constraint station_events_module_check;

alter table deadair.station_events
    add constraint station_events_module_check
    check (module in ('playout', 'director', 'render', 'catalog', 'plugins', 'storage'));

-- migrate:down

-- Rows the sweep wrote have to go before the narrower constraint can be believed again. They are the
-- feed's own record of housekeeping and nothing reads them but a person, so deleting them costs a
-- rolled-back station nothing it can use.
delete from deadair.station_events where module = 'storage';

alter table deadair.station_events drop constraint station_events_module_check;

alter table deadair.station_events
    add constraint station_events_module_check
    check (module in ('playout', 'director', 'render', 'catalog', 'plugins'));
