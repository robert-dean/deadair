# The loop between the station and where the operator actually listens

**Written:** 2026-08-09, against the goal of replacing a streaming service rather than of finishing a
subsystem.
**Piece 1 is solved, 2026-08-16**, and not in this tree: the operator fronted the mount with a
Cloudflare tunnel and listens on a phone and an AVR. Nothing here was built, and nothing here needs
to be. See §1 for what that settles and the three questions it makes live.
**State of the rest:** catalog sync is already automatic; pieces 2 and 3 do not exist.

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

**Smaller since piece 3 demoted itself** (see the note at the bottom of that section): with history
out unlikely to be built, `playlist-modify-private` has nothing asking for it, and the batching
argument collapses to one addition (`user-read-recently-played`) plus two removals. Batch it anyway,
because the removals are free and the re-consent is the same prompt either way.

## 1. Audio out, which is the only one that replaces anything

**Solved 2026-08-16, outside this repository.** A Cloudflare tunnel fronts the mount, and the
operator listens on a phone and on an AVR. This piece is closed, and the rest of this section is kept
for what it settles and for the three things it makes live.

The problem it closed: Icecast binds `127.0.0.1:8000`, and the comment beside it says the edge or
tunnel fronts it with HTTPS terminating there ([docker-compose.yml](../../docker-compose.yml)). No
compose file defines such a tunnel, and the production deployment repeats the same expectation for
the edge in front of it — today that is the one port the production image publishes
([deploy/README.md](../../deploy/README.md)). That comment described an intended deployment rather
than one that existed, and it was the whole of why the station was a desk toy. **It is now accurate, and the deployment it describes lives
in the operator's Cloudflare account rather than in a compose file.** Anything that reads those
comments as a plan should read them as a description.

**The three questions this makes live**, each of which was theoretical while the mount was on the
LAN:

- **The mount is anonymous and is now on the public internet.** It was anonymous because it was
  reachable only from the LAN, and that reason is gone. A tunnel is not by itself an authorization
  decision. [service-actors.md](service-actors.md) is what a publicly reachable Icecast makes more
  interesting, and the shared bridge secret is the thing to look at first.
- **An Opus mount now has a real argument** rather than a theoretical one.
  [stream-formats.md](stream-formats.md) makes the case abstractly; a phone on a mobile connection is
  what makes it concrete, and the bitrate interaction with Icecast's byte-denominated burst and queue
  is in [stream-quality-ceiling.md](stream-quality-ceiling.md).
- **The AVR is [now-playing-displays.md](now-playing-displays.md)**, arriving from the other
  direction and needing no edge or TLS at all. It is listenable today by adding the mount as a custom
  stream URL, and what it does not get is a display worth looking at. That file is blocked on one
  probe.

What this piece was, kept because it is what a second listening place would need again:

- A real edge in front of the mount, terminating TLS.
- A URL a phone and a car browser will each actually open. These are not necessarily the same URL,
  and neither is necessarily the console.
- A decision about whether the mount stays anonymous once it is on the public internet.

**The audience gate needs no change and is already right for this.** `playout.airMode: audience`
means a phone connecting is what puts the station on air and disconnecting is what takes it off,
which is exactly the desired behaviour for something listened to in transit. See
[audience-gated-air](../internals/playout.md) and `stream/README.md`.

Related and already written down: `from-v1.md` covers the previous station's push destinations, and
`stream-formats.md` covers the mounts this tree does not serve. A phone on a mobile connection is
the first real argument for an Opus mount that file makes theoretically.

A hardware player on the home network is the same piece arriving from the other direction: it needs
no edge and no TLS, and it is listenable today by adding the mount as a custom stream URL. What it
does not get is a display worth looking at, which is its own problem with its own file —
[now-playing-displays.md](now-playing-displays.md).

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

**Piece one landed, so this demotes itself rather than coming up the list.** The station is now
audible in the two places this was for. What survives is a smaller and different thing: a record of
what aired, in an app used for looking things up rather than for listening. That is worth strictly
less than a write sub-capability on `MusicProviderCatalog` costs, so it should not be built until
something else wants provider writes. **It is also the only remaining reason to add
`playlist-modify-private` to the grant**, which means the re-consent table above is now a one-row
change for piece 2 rather than a three-row change for both.

## Related

[spotify-listening-profile.md](spotify-listening-profile.md) for the whole of piece two.
[stream-formats.md](stream-formats.md) for the mounts, [service-actors.md](service-actors.md) for the
credentials a publicly reachable Icecast makes more interesting, and [from-v1.md](from-v1.md) for the
previous station's now-playing sinks and push destinations.
