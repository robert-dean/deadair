-- migrate:up

-- A slot's mood becomes a list of STAGES the stretch of the day passes through, in order.
--
-- 0066 gave a slot and its running order one mood to lean into for the whole broadcast. A four-hour
-- evening that should open warm and end somewhere lonelier could only say one of those. Each refill
-- now works out how far through the slot its records will air and leans into that stage's mood
-- (`director/mood.lean.ts`); a single stage is exactly the old behaviour, and the backfill below turns
-- every existing mood into a one-stage list.
--
-- At most four stages, so a stage lasts long enough for a refill to land in it. Each element is one of
-- the seven moods the judgement uses; null is no lean. An empty list is refused rather than stored, so
-- "no lean" has one spelling.
--
-- Numbered 0084 because 0082 and 0083 are taken on other branches; dbmate applies any version it has
-- not recorded, in order, so they can land in any order.
alter table deadair.schedule_slots
    add column moods text[] constraint schedule_slots_moods_check check (
        moods is null
        or (cardinality(moods) between 1 and 4
            and moods <@ array['love', 'happiness', 'comfort', 'sadness', 'loneliness', 'anger', 'fear']::text[])
    );
update deadair.schedule_slots set moods = array[mood] where mood is not null;
alter table deadair.schedule_slots drop column mood;

alter table deadair.station_lineup
    add column moods text[] constraint station_lineup_moods_check check (
        moods is null
        or (cardinality(moods) between 1 and 4
            and moods <@ array['love', 'happiness', 'comfort', 'sadness', 'loneliness', 'anger', 'fear']::text[])
    );
update deadair.station_lineup set moods = array[mood] where mood is not null;
alter table deadair.station_lineup drop column mood;

-- migrate:down

alter table deadair.station_lineup
    add column mood text constraint station_lineup_mood_check check (mood is null or mood in ('love', 'happiness', 'comfort', 'sadness', 'loneliness', 'anger', 'fear'));
update deadair.station_lineup set mood = moods[1] where moods is not null;
alter table deadair.station_lineup drop column moods;

alter table deadair.schedule_slots
    add column mood text constraint schedule_slots_mood_check check (mood is null or mood in ('love', 'happiness', 'comfort', 'sadness', 'loneliness', 'anger', 'fear'));
update deadair.schedule_slots set mood = moods[1] where moods is not null;
alter table deadair.schedule_slots drop column moods;
