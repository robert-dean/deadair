-- migrate:up

-- `sometimes`: a character handed one fact on a share of its links rather than every one.
--
-- 0107's `always` asks for a fact in every link, which suits a presenter whose patter is about the
-- music and wears thin on one whose patter is about the room. `sometimes` draws per break, from the
-- segment id so a re-offered break draws the same way (`triviaForBreak`, `SOMETIMES_FACT_ODDS`), and
-- a break that draws is treated exactly as `always`, one that does not exactly as `never`.
--
-- 0106's form and 0106's reason.
alter table deadair.personas drop constraint personas_trivia_check;

alter table deadair.personas
    add constraint personas_trivia_check
    check (trivia in ('keen', 'never', 'always', 'sometimes'));

-- migrate:down

update deadair.personas set trivia = null where trivia = 'sometimes';

alter table deadair.personas drop constraint personas_trivia_check;

alter table deadair.personas
    add constraint personas_trivia_check
    check (trivia in ('keen', 'never', 'always'));
