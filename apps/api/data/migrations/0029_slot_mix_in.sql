-- migrate:up

-- Whether a broadcast built from this slot mixes records that sound like its playlist's own in among
-- them, carried onto the running order at a changeover the way `callins` is.
--
-- NULLABLE, for `callins`' reason: null leaves the station's own `rotation.mixInSimilar` standing,
-- where `false` would be this slot overruling a station that mixes into every playlist. It is the
-- same three-way `PutOnAirInput.mixInSimilar` has. A slot with no playlist, or one in `setlist` or
-- `feature` mode, never mixes whatever this says.
alter table deadair.schedule_slots add column mix_in_similar boolean;

-- migrate:down

alter table deadair.schedule_slots drop column mix_in_similar;
