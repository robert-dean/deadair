-- migrate:up

-- The tracks on an album, by album.
--
-- Nothing asked that question until the deep-cut lean (`rediscover.ts`): which of the albums a refill
-- just sampled hold a record the operator liked. `album_id` has had no index since 0005, so each of
-- those lookups was a scan of every track in the library, once per refill. Partial on the live rows,
-- because a merged row is never a record anybody liked on its own and never one the draw offers.
create index tracks_album_idx on deadair.tracks (album_id) where merged_into_id is null;

-- migrate:down

drop index deadair.tracks_album_idx;
