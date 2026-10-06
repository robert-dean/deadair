-- migrate:up

-- Where in a break a pad may land, and when a presenter should reach for it.
--
-- `placements` is where the SOUND may fall: before the first word, between two, or after the last.
-- A guitar lick after the last word sounds like the next record starting, and before the first like
-- the tail of the one that just ended, so a sound can be held to the middle. Every pad starts with
-- all three, which is what every pad could do before this column, and an empty list is refused
-- because a pad that may go nowhere is a pad turned down, and `state` already says that.
--
-- `cue` is WHEN, in the operator's words ("right after a punchline"). It is shown to the model beside
-- the pad and checked by nothing, since no code can tell a joke from any other sentence. What it
-- does decide is that the station's own writers, which append a sound to a template line, leave a
-- cued pad alone: a template line was never the moment the cue describes.
alter table deadair.pads
    add column placements text[] not null default array['start', 'middle', 'end']::text[],
    add column cue text,
    add constraint pads_placements_check check (
        cardinality(placements) > 0 and placements <@ array['start', 'middle', 'end']::text[]
    ),
    add constraint pads_cue_check check (cue is null or (length(cue) between 1 and 200));

-- migrate:down

alter table deadair.pads
    drop constraint pads_cue_check,
    drop constraint pads_placements_check,
    drop column cue,
    drop column placements;
