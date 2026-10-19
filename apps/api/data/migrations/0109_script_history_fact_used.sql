-- migrate:up

-- Whether a break said the one fact it was handed, for a presenter at `trivia: always` (or a
-- `sometimes` link that drew one).
--
-- Those rungs choose the fact in code and ASK for it rather than offering it, and whether the model
-- did what it was asked is the number that decides whether asking is enough or a refusal is worth
-- building. `previous` and `next` already record what each attempt was shown; this records what the
-- station's own read-back (`mentionsFact`) made of the script against it. Never asked of the model.
--
-- Null for every row where no fact was required, and for an attempt that produced no words.
alter table deadair.script_history add column fact_used boolean;

-- migrate:down

alter table deadair.script_history drop column if exists fact_used;
