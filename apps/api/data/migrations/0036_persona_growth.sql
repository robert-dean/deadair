-- migrate:up

-- Whether this character may change itself, or only ever propose.
--
-- Everything a model writes about a character currently arrives `suggested` and waits for an
-- operator. That is `deadair.pronunciations`' posture, inherited deliberately by `persona_notes` and
-- `persona_stories`, and the argument for it is written out in both: no amount of catalogue entails
-- that this character was ever in that room, so the operator is the check because nothing else can
-- be.
--
-- What changed is that there is now a way BACK. A character's accumulated memory can be rolled back
-- to a moment, which makes "let it run and see" a thing an operator can undo in one click rather
-- than a decision they are stuck with. That is the whole reason this column can exist at all, and it
-- is why it arrived after the rollback rather than with the stores it governs.
--
-- **Nullable, and absent means `proposes`.** Not `not null default 'proposes'`, because the two are
-- different claims: a null is a station that has never been asked, and this is precisely the setting
-- where "nobody has decided" should not be recorded as a decision. It also keeps every row written
-- before this migration honest — those characters were never offered the choice.
--
-- A fresh install therefore proposes, which is `rotation.breaks`' rule: a character changing on its
-- own is a feature an operator opts into, not the behaviour of a station nobody has configured.
alter table deadair.personas add column growth text
    constraint personas_growth_check check (growth is null or growth in ('proposes', 'self-directed'));

-- migrate:down

alter table deadair.personas drop column if exists growth;
