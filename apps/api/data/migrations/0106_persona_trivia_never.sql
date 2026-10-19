-- migrate:up

-- A rung BELOW the station's ordinary break: a character that is never handed the notes.
--
-- 0041 argued there was nothing below the ordinary break to name, because the ordinary break already
-- treated the notes as optional. Optional turned out to be something a model reads as an offer it
-- should take, and some characters are better without trivia at all: a reaction is their whole job,
-- and a true sentence about a session drummer is not one. `never` is that said in code rather than
-- in the prompt. The break is shown no notes, nothing is stamped as used, and the facts' years stop
-- counting as years the break may say.
--
-- Dropped and re-added rather than altered, for 0061's reason; adding a value only widens what passes.
-- Written `check (trivia in (...))` rather than 0041's `is null or` form, which passes a null all the
-- same and is the form `sync.enum.overrides.ts` reads back into the generated types.
alter table deadair.personas drop constraint personas_trivia_check;

alter table deadair.personas
    add constraint personas_trivia_check
    check (trivia in ('keen', 'never'));

-- migrate:down

-- A `never` row has no rung in the narrower list, and absent is the closest thing to it.
update deadair.personas set trivia = null where trivia = 'never';

alter table deadair.personas drop constraint personas_trivia_check;

alter table deadair.personas
    add constraint personas_trivia_check
    check (trivia is null or trivia in ('keen'));
