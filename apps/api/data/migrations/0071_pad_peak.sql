-- migrate:up

-- How hot a pad's loudest moment is, in dBTP, beside how loud it is.
--
-- Integrated loudness is gated in 400ms blocks, so a rimshot or a short drop produces no block and
-- `loudness_lufs` stays null for most of the rack. The peak needs no block: the analyzer reports it
-- for any sound with a sample in it, and it is what the render path levels a short pad by when there
-- is no loudness figure. Null until something measures it, exactly as `loudness_lufs` is.
alter table deadair.pads
    add column peak_db double precision;

-- migrate:down

alter table deadair.pads
    drop column peak_db;
