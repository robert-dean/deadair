-- migrate:up

-- The mood a stretch of the day leans into, beside its brief and its period.
--
-- `0017_schedule.sql` argues that a slot carries a BRIEF in prose and deliberately not a bag of genre
-- and mood filters, and that is right about anything only a model can read. The period was the first
-- exception, because a year range is something the deterministic draw can honour on its own. A mood is
-- the second, and for the same reason: once a model has judged each record's mood
-- (`deadair.track_lyric_labels`), "lean toward comfort" is a number the floor can multiply a draw by,
-- with no model in the room. It only ever LEANS: a judgement read off lyrics is wrong often enough that
-- the draw makes a fitting record more likely and never keeps another off the air (`director/mood.lean.ts`).
--
-- One of the seven moods the judgement uses, or null for no lean. Copied from the slot onto the
-- running order at a changeover, beside `era_from` and `era_to`, so it steers every refill for as long
-- as the broadcast runs rather than its first batch.
alter table deadair.schedule_slots
    add column mood text constraint schedule_slots_mood_check check (mood is null or mood in ('love', 'happiness', 'comfort', 'sadness', 'loneliness', 'anger', 'fear'));

alter table deadair.station_lineup
    add column mood text constraint station_lineup_mood_check check (mood is null or mood in ('love', 'happiness', 'comfort', 'sadness', 'loneliness', 'anger', 'fear'));

-- migrate:down

alter table deadair.station_lineup drop column mood;
alter table deadair.schedule_slots drop column mood;
