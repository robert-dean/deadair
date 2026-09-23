-- migrate:up

-- When a refresh found the plugin no longer listing a piece. Null while it is still listed.
--
-- 0032 keeps a row when a series stops listing a piece, because a chapter read last month has not
-- stopped having been read. That is still true: nothing here deletes anything. What it got wrong is
-- that a KEPT row was also still a CANDIDATE. A serial takes the lowest unaired ordinal, so a chapter
-- the plugin stopped offering (an operator marking a licence page or a contents page as not to be
-- read, after the station had already listed the book) stayed next forever: its render asked the
-- plugin for words, got none, failed three times, and the band declined every time after. A book whose
-- skipped section came first never started at all. Every read that picks a piece now passes over a
-- withdrawn one, and one that has already been spoken keeps its audio and simply never airs.
--
-- It is what the PLUGIN said, not what the station did, which is why a refresh writes it: it is
-- `seen_at`'s complement, and belongs with it above 0032's "Nothing below is ever written by a
-- refresh" line. `alter table` cannot put it there, so this is where that is written down. A piece
-- listed again is no longer withdrawn: the upsert clears it.
--
-- A refresh withdraws only from a listing it can trust to be the whole series: one that is not empty
-- (the capability tells a plugin to answer `[]` for a book it could not read today) and is shorter
-- than the most the station asks for (a listing that long may be a window, with the rest still there).
-- `narrations.service.ts` has both guards beside the call.
alter table deadair.narration_pieces add column withdrawn_at timestamptz;

-- migrate:down

alter table deadair.narration_pieces drop column if exists withdrawn_at;
