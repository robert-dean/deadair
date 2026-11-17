-- migrate:up

-- The station's model's answer to a question a show's mix flow asks about a record: "a sinful pop
-- hit?" of a pop record on the Church show.
--
-- A tag says a record is pop; nothing in the catalog says it is the kind of pop a brief meant. A judge
-- split asks the model once per record and question and keeps the answer, so a show asks nothing on
-- air and the model is not asked the same thing twice. Keyed by a hash of the normalised question, so
-- two shows asking the same thing share their answers.
--
-- A row with no `answer` and no `judged_at` is PENDING: the picker wrote it when it met a record it
-- had no answer for, held the record, and `MixJudgeJob` asks. `answer` false with a `judged_at` is a
-- record the model said no to or could not place, which is not aired on a guess.
create table deadair.mix_judgements (
    question_key text not null,
    track_id uuid not null references deadair.tracks (id) on delete cascade,
    question text not null constraint mix_judgements_question_check check (length(btrim(question)) between 1 and 200),
    answer boolean,
    version text,
    judged_at timestamptz,
    failures integer not null default 0,
    last_error text,
    retry_after timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    primary key (question_key, track_id)
);

create index mix_judgements_pending on deadair.mix_judgements (created_at) where judged_at is null;

-- migrate:down

drop table deadair.mix_judgements;
