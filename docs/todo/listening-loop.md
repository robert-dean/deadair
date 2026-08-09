# The loop between the station and where the operator actually listens

**Written:** 2026-08-09, against the goal of replacing a streaming service rather than of finishing a
subsystem.
**State of the tree:** the station is audible at the desk and nowhere else. Catalog sync is already
automatic; nothing else in this file exists.

---

## The shape

The operator listens to Spotify daily on a phone and in a car, and to deadair only at the desk. Three
pieces close that gap, and they are one loop rather than three features:

1. **Signal in.** What gets played elsewhere feeds the station's sense of taste.
2. **Audio out.** The station is listenable where the operator actually is.
3. **History out.** What the station programmed is available in the app already used in the car.

They share one dependency, and it is the reason this is a single file rather than three.

## What is already automatic, so it does not get rebuilt

`CatalogSyncJob` runs hourly on cron across every music plugin
([job.mappings.ts](../../apps/api/src/modules/jobs/job.mappings.ts)). The Spotify library already
flows into the catalog with no operator action. "Auto-sync" does not mean this; it is done.

## The one ordering constraint: the grant is re-consented once

`SPOTIFY_SCOPES` in [spotify.manifest.ts](../../plugins/spotify/src/spotify.manifest.ts) is wrong in
three directions at once, and every correction re-authorizes every connected account:

| Change | Why | Which piece needs it |
| --- | --- | --- |
| Drop `user-read-private`, `user-read-email` | February 2026 stripped the fields they unlock; see [spotify-listening-profile.md](spotify-listening-profile.md) | none, it is pure friction |
| Add `user-read-recently-played` | The richest of the three taste signals, and the only one not already granted | signal in |
| Add `playlist-modify-private` (or `-public`) | Nothing in the tree can write a playlist today | history out |

**So the scope change is its own commit, done once, before either half is built.** Shipping it per
feature asks the operator to re-consent three times for one grant. `user-top-read` and
`user-library-read` are already granted and already uncalled, so the parts of "signal in" that use
those need no consent at all and could land ahead of this.

## 1. Audio out, which is the only one that replaces anything

**This is first, because the other two improve a station that cannot be listened to.**

Icecast binds `127.0.0.1:8000`, and the comment beside it says the edge or tunnel fronts it with
HTTPS terminating there ([docker-compose.yml](../../docker-compose.yml)). No compose file defines
such a tunnel. `docker-compose.prod.yml` repeats the same expectation for nginx. That comment
describes an intended deployment, not one that exists, and it is the whole of why the station is a
desk toy.

What this piece is:

- A real edge in front of the mount, terminating TLS.
- A URL a phone and a car browser will each actually open. These are not necessarily the same URL,
  and neither is necessarily the console.
- A decision about whether the mount stays anonymous once it is on the public internet. It is
  anonymous today because it was reachable only from the LAN.

**The audience gate needs no change and is already right for this.** `playout.airMode: audience`
means a phone connecting is what puts the station on air and disconnecting is what takes it off,
which is exactly the desired behaviour for something listened to in transit. See
[audience-gated-air](../../CLAUDE.md) and `stream/README.md`.

Related and already written down: `from-v1.md` covers the previous station's push destinations, and
`stream-formats.md` covers the mounts this tree does not serve. A phone on a mobile connection is
the first real argument for an Opus mount that file makes theoretically.

## 2. Signal in

Fully scoped already in [spotify-listening-profile.md](spotify-listening-profile.md): the two ways
in, what the February 2026 round did and did not take, and why there is no popularity signal left to
rank on. Nothing here supersedes it. Two things that file does not say, because it was written
before this goal was stated:

**Recently-played is the piece this goal actually wants.** Top items are a slow-moving portrait;
recently-played is what was on in the car this morning. That file correctly notes it is the one
costing a re-consent, which is what the table above batches.

**Decide what the signal feeds before building it.** A station that plays more of what its listener
already plays is the thing a streaming service does, and it is not obviously the thing worth
replacing it with. The two ways in map onto this choice cleanly: synthetic playlists feed the
rotation pool, and the `profile` sub-capability is the shape with somewhere to put an artist and its
genres, which is what patter and steering would read. Feeding the DJ without feeding the selector is
a coherent and possibly better answer than either.

## 3. History out

Last, and possibly never. `deadair.play_history` already holds what aired. What does not exist is any
way to write to a provider: `MusicProviderCatalog` is four read methods
(`searchTracks`, `getTrack`, `listPlaylists`, `getPlaylistTracks`), so this needs a write
sub-capability alongside the `profile` one, or a Spotify-specific route that bypasses the seam and
should not.

It is listed last because it is the piece most likely to be made pointless by the first: its entire
value is being able to hear the station's programming in a place the station cannot reach, and piece
one is that place becoming reachable.

## Related

[spotify-listening-profile.md](spotify-listening-profile.md) for the whole of piece two.
[stream-formats.md](stream-formats.md) for the mounts, [service-actors.md](service-actors.md) for the
credentials a publicly reachable Icecast makes more interesting, and [from-v1.md](from-v1.md) for the
previous station's now-playing sinks and push destinations.
