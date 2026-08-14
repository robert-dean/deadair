# Deferred: several stations from one install

**Designed:** 2026-08-07, while building the music director
**Status:** deferred deliberately. Nothing needs a second station yet, and building the fan-out now
would be schema ahead of use.

deadair is heading toward several stations from one install, not just one mount.

## The shape when it lands

- `deadair.stations`, one row per station: slug (`main`), display name, whether it is on air, the
  on-air list it is playing, how far through it, and that station's default rotation rules. This
  **subsumes the on-air pointer**, which today is a one-row-per-slot table keyed `slot = 'main'`.
  That slot column exists precisely so this becomes rows rather than a migration.
- ~~The ordered on-air lists gain a `station_id`, as does `deadair.play_history`.~~ **Done, ahead of
  the rest.** `station_key` is now on `play_history`, `segments`, `segment_events`, `script_history`
  and `station_events` as well as `station_lineup` and `station_air`, defaulting to `'main'`, and the
  reads that are per-station questions filter on it: `play_history`'s three indexes lead with it, and
  the activity feed applies it inside each arm of its union. It was done early because it is free
  while there is one station and a migration over live broadcast state once there are two. A repeat
  window is per station: two stations may legitimately both be playing the same record.
  What is NOT done is the rest of this line's implication — nothing yet resolves a station key from a
  request, so `StationIdentity.stationKey` is a constant and this table stakes the ground rather than
  using it.
- Each station gets its own Icecast mount, which means `stream.*` settings stop being global and
  become per-station rows. That is the expensive half, and the reason this is deferred rather than
  half-built.

## Naming that follows from it

The `station_*` prefix is deliberate, and "playlist" is reserved for `deadair.playlists` (a saved
library of tracks deadair owns) rather than for what is on air. See [rundown.md](rundown.md) for the
served-vs-airing split the on-air list sits on top of.
