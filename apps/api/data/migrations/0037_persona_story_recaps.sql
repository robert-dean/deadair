-- migrate:up

-- Where a running bit has GOT to, in one line, so the prompt need not carry the words themselves.
--
-- A `bit` is the one kind of material shown its own history: it only works if a listener recognises
-- the character coming back to it, and the character can only do that knowing where it left off. So
-- the last couple of tellings go into the prompt verbatim — which is the strongest possible
-- invitation to reproduce them, and is why `retold-verbatim` had to exist at all.
--
-- A recap is the better answer to the same need. It says what the thing has become without putting
-- the exact sentences in front of the model, so the hazard is removed rather than guarded: a model
-- cannot repeat words it was never shown. The guard stays, because a coincidence is still possible
-- and because a bit with fewer than a few tellings has no recap yet.
--
-- **Append-only, latest wins.** A recap is a fact about a moment — what this had become by then —
-- and rewriting one in place would lose the only thing that makes it checkable, which is that an
-- operator can see the summary drift away from the tellings under it. `script_history`'s posture,
-- and the ledger's beside it.
--
-- **It is a SUMMARY and never an invention**, which is what lets it go live unattended where a
-- proposed story cannot. The pass writes it from tellings the station itself recorded, and what it
-- replaces in the prompt is those same tellings shown raw — so it is strictly less exposure than
-- the thing it displaces, not more. That argument is the whole of why there is no `state` column
-- here: there is nothing for an operator to accept, only something for them to correct.
create table deadair.persona_story_recaps (
    id uuid not null default gen_random_uuid() primary key,
    created_at timestamptz not null default now(),
    station_key text not null default 'main',
    -- CASCADE, as every other child of a story is: a recap of a story that is gone summarises
    -- nothing.
    story_id uuid not null references deadair.persona_stories (id) on delete cascade,
    recap text not null check (length(btrim(recap)) > 0),
    -- How many aired tellings it was written over, so a pass can tell whether the thing has moved
    -- since. Cheaper and more honest than comparing timestamps: what matters is whether the
    -- character has DONE anything with it, not how long ago.
    tellings integer not null check (tellings >= 0)
);

-- The read every break makes for a bit: the newest recap for this story.
create index persona_story_recaps_story_idx on deadair.persona_story_recaps (story_id, created_at desc);

-- And the one a rollback deletes over, which is per character rather than per story.
create index persona_story_recaps_station_idx on deadair.persona_story_recaps (station_key, created_at desc);

-- migrate:down

drop table if exists deadair.persona_story_recaps;
