-- migrate:up

-- Whether the break this audition wrote actually TOLD the story it was handed.
--
-- `mentionsStory` decides that on air, by reading the writer's own answer back, and everything an
-- arc does rests on it: a part it says NO to is offered again, and a part it says YES to is never
-- offered again. The second is the expensive direction — a listener simply never gets that piece —
-- and nothing anywhere would notice.
--
-- So the check needs measuring against real scripts before a real arc is trusted to it, and an
-- audition is the one place that can happen: it writes a character's breaks in bulk, with the same
-- writers and the same prompt, and nothing it does reaches a listener. Recording the answer beside
-- the script turns "is the bar right" into a query over a run rather than an argument.
--
-- Null means the break carried no story at all, which is most of them and is not the same as `false`
-- — one is nothing to judge and the other is a story the writer passed over.
--
-- **An audition deliberately does NOT walk an arc.** It offers the same part on every transition it
-- reaches for one, and that is the right shape for this question rather than a shortcut around it:
-- what is being measured is how often the check recognises a telling, and N independent attempts at
-- one part answer that where one attempt each at N parts does not. Nothing in a run is stamped, so
-- there is nothing to advance anyway.
alter table deadair.persona_audition_breaks add column told boolean;

-- migrate:down

alter table deadair.persona_audition_breaks drop column if exists told;
