-- migrate:up

-- A rung between the ordinary break and `keen`: a character handed exactly one fact for every link.
--
-- The ordinary break offers the notes as optional and a model mostly declines them; `keen` makes them
-- the whole break. `always` is the middle a presenter with patter of its own was missing: code chooses
-- ONE fact for the break (`EnrichmentReadService.factForBreak`, a sourced claim about the next record
-- first) and the prompt asks for it to be said in the presenter's own words beside whatever else they
-- would say. Whether it was said is measured rather than refused.
--
-- 0106's form and 0106's reason.
alter table deadair.personas drop constraint personas_trivia_check;

alter table deadair.personas
    add constraint personas_trivia_check
    check (trivia in ('keen', 'never', 'always'));

-- migrate:down

update deadair.personas set trivia = null where trivia = 'always';

alter table deadair.personas drop constraint personas_trivia_check;

alter table deadair.personas
    add constraint personas_trivia_check
    check (trivia in ('keen', 'never'));
