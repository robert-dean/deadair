-- migrate:up

-- Whether this character leans on what the station knows about a record, or only reaches for it.
--
-- The station's ordinary break treats a record's notes as optional: at most two, drawn from the
-- recording before its album and its album before whoever made it, offered "in case one is worth
-- saying", and a model told that most breaks are better without one. That is right for a presenter
-- whose job is a reaction, and it is exactly wrong for one whose job is the story behind the record.
-- A chart-countdown host told to say where a song came from, and told in the same prompt that the
-- notes are probably not worth using, hedges between the two and says neither.
--
-- `keen` asks for the other bargain: a note about each of the recording, its record and its artist
-- before a second about any, four in all, the notes offered as the material of the break rather than
-- as a garnish, and the room to tell one. The grounding rules do not move. A keen presenter may still
-- only say what a note says.
--
-- **Nullable, and absent means the station's ordinary discipline**, for `latitude`'s reason one column
-- over: it is a rung ABOVE the default rather than a choice between equals, so there is no value for
-- "ordinary" to store and every row written before this migration keeps the break it had.
alter table deadair.personas add column trivia text
    constraint personas_trivia_check check (trivia is null or trivia in ('keen'));

-- migrate:down

alter table deadair.personas drop column if exists trivia;
