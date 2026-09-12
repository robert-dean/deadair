-- migrate:up

-- How THESE words are to be read, in the station's own vocabulary: `hushed` or `frantic`, the whole of
-- `SPEECH_DELIVERIES` in the plugin SDK. Null is the voice's own ordinary reading, which is what
-- nearly every row holds and always will.
--
-- A word and not a number, on `voice`'s argument one column over (0008): the station names what it
-- wants and the speech plugin translates it into whatever its engine takes, so a change of engine
-- rewrites no row. Unconstrained text for the same reason `kind` is: the vocabulary belongs to the
-- plugin SDK, and a third reading must not need a migration here. The host refuses a word it does not
-- know where one comes in, and drops one the engine does not claim before it speaks.
--
-- Unlike `voice`, it is cleared with the words. A voice is an instruction about WHO says a line and
-- survives a rewrite; a delivery is part of what was written, so a new script states its own reading
-- or none, and a recast that throws the words away throws this away with them.
alter table deadair.segments add column delivery text;

-- The same word on the record of what was written, because this table exists to outlive the segment
-- and a reading the model chose is as much a part of what it wrote as the words. The raw answer that
-- would also show it is kept only while `llm.captureWrites` is on.
alter table deadair.script_history add column delivery text;

-- migrate:down

alter table deadair.script_history drop column delivery;
alter table deadair.segments drop column delivery;
