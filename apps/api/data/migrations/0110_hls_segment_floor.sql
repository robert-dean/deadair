-- migrate:up

-- `stream.hlsSegmentCount` has a floor of ten now, where it was three (see `HLS_SEGMENT_COUNT_RANGE`
-- in `stream.settings.ts` and docs/internals/playout.md). The resolver already lifts a lower stored
-- figure to ten on read, so this changes nothing about what Liquidsoap is given. It is here so the
-- settings page shows the number the station is running on, rather than a three it no longer obeys
-- and a field its own range refuses to save.
--
-- Only a row that reads as a whole number below the floor is touched. Anything else (a blank, a
-- figure in range, text that is not a number) is left exactly as it was, and the resolver deals with
-- it as it always has.
update deadair.settings
set value = '10'
where key = 'stream.hlsSegmentCount'
    -- A CASE rather than `~ ... and ::integer < 10`, because Postgres does not promise to test the
    -- pattern before it attempts the cast, and a cast that fails fails the whole migration.
    and case when btrim(value) ~ '^[0-9]{1,9}$' then btrim(value)::integer < 10 else false end;

-- migrate:down

-- Nothing to undo. The figure that was stored before is not recorded anywhere, and putting back a
-- guess would be worse than leaving ten, which the old range accepted too.
select 1;
