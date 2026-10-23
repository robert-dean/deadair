-- migrate:up

-- Until when a record, a release or an artist is kept off the station: a scheduling decision with
-- an end date, made without passing judgement on the thing.
--
-- Not the rating. A dislike is an instruction with no end and the whole tree treats it as one; a
-- suspension spelled as a dislike would overwrite the operator's opinion (a liked artist suspended
-- for five days would come back neutral) and nothing would lapse it. So it is its own column, beside
-- the `rating` each of these tables already carries, and every read that keeps a dislike off the air
-- keeps a suspension off with it (`catalog/suspension.ts`).
--
-- Read at the point of use (`suspended_until > now()`) and never swept, after
-- `station_lineup.hold_until`: nothing can fail overnight and leave an artist off the air, and a lapsed
-- row reads exactly like one never suspended. Unlike the hold, `infinity` is refused: an indefinite
-- suspension is a dislike, and two spellings of one state would want two consoles to set them from.
alter table deadair.tracks
    add column suspended_until timestamptz
    constraint tracks_suspended_until_finite check (suspended_until is null or isfinite(suspended_until));
alter table deadair.albums
    add column suspended_until timestamptz
    constraint albums_suspended_until_finite check (suspended_until is null or isfinite(suspended_until));
alter table deadair.artists
    add column suspended_until timestamptz
    constraint artists_suspended_until_finite check (suspended_until is null or isfinite(suspended_until));

-- migrate:down

alter table deadair.artists drop column if exists suspended_until;
alter table deadair.albums drop column if exists suspended_until;
alter table deadair.tracks drop column if exists suspended_until;
