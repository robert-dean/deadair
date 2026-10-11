-- migrate:up

-- Re-read every timed lyric LRCLIB has given the station, once, for the per-word timings in it.
--
-- Until now the LRCLIB parser stripped enhanced LRC's `<mm:ss.xx>` word tags and stored only each
-- line's start, so the words were thrown away on the way in. The parser now keeps them, but a row that
-- holds words has no `expires_at` and is never asked about again, so without this nothing already
-- stored would ever gain them.
--
-- Expiring the rows is enough, because nothing re-reads a lyric when it is SERVED: the routes read the
-- table as it stands, expired or not, so every record keeps showing its words throughout. What picks
-- the rows up is the lyrics walk (`catalog.fetch_lyrics`), which is already bounded: at most 75
-- records a quarter hour, inside an 11-minute budget, one paced request at a time, and in value order
-- (what is about to air first). So this is a background trickle against LRCLIB rather than a burst,
-- and on a station with `lyrics.fetch` off it is nothing at all. A re-read that finds words stores them
-- and clears the date again; one that now misses keeps the words it had (`recordMiss`).
--
-- Only rows with timed lines: a plain-only answer has no line timings, so it has no word timings
-- either, and re-asking about it would be a request for nothing. The provider is the plugin's manifest
-- id, `deadair.lrclib`.
--
-- Numbered 0087 because 0086 is taken on main; dbmate applies any version it has not recorded, in
-- order, so the two can land either way round.
update deadair.track_lyrics
   set expires_at = now()
 where provider = 'deadair.lrclib'
   and synced is not null
   and expires_at is null;

-- migrate:down

-- Nothing to undo: an expired row is either re-read already, which put its date back to null, or will
-- be, and putting the date back by hand would only stop that.
select 1;
