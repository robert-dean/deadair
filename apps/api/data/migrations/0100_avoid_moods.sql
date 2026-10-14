-- migrate:up

-- The moods a stretch of the day, and the broadcast a changeover builds from it, steer AWAY from.
--
-- 0084's `moods` are leaned into: a record a model judged to be in one is drawn twice as often. These are
-- the same judgement read the other way up, and held to the same standing: a record judged to be in an
-- avoided mood is drawn half as often and never refused (`director/mood.lean.ts`). Not a never-play
-- rule, because the judgement is right about half the time, and `block_rules` refuses on a provider's
-- tags rather than on a model's reading of the lyrics.
--
-- A set rather than stages: an avoided mood holds for the whole slot. At most six of the seven, since
-- avoiding all of them leans away from every judged record at once and says nothing. Null is none, and
-- an empty list is refused rather than stored, so "nothing avoided" has one spelling.
alter table deadair.schedule_slots
    add column avoid_moods text[] constraint schedule_slots_avoid_moods_check check (
        avoid_moods is null
        or (cardinality(avoid_moods) between 1 and 6
            and avoid_moods <@ array['love', 'happiness', 'comfort', 'sadness', 'loneliness', 'anger', 'fear']::text[])
    );

alter table deadair.station_lineup
    add column avoid_moods text[] constraint station_lineup_avoid_moods_check check (
        avoid_moods is null
        or (cardinality(avoid_moods) between 1 and 6
            and avoid_moods <@ array['love', 'happiness', 'comfort', 'sadness', 'loneliness', 'anger', 'fear']::text[])
    );

-- migrate:down

alter table deadair.station_lineup drop column avoid_moods;
alter table deadair.schedule_slots drop column avoid_moods;
