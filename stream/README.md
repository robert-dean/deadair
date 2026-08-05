# Stream (Icecast + Liquidsoap)

> **Read the app-side halves as the target, not the tree.** These assets are the finished stream
> from the pre-re-scaffold repo, restored ahead of the app code that drives them. What is NOT built
> here yet, and what this file therefore describes as intent: the config materializer that writes
> `radio.env`, the playout module (`Rundown`, `PlayoutPusher`, `/playout/aired`), and the
> Spotify login route. What is genuinely gone rather than pending: the render pipeline, so nothing
> pushes DJ voice to the harbor and there is no `GET /playout/segment/:id`; and Navidrome, so
> Subsonic URLs are a shape this supports rather than a source that exists. There is no director,
> so the duck and talk-over settings below are constants rather than console knobs.

Liquidsoap mixes a **music bed** (ducked under the DJ/news/weather voice) and pushes
MP3 to the **Icecast** mount. Config comes from `radio.env` (materialized from the DB
by the app, falling back to `radio.default.env`) and the committed `radio.liq`.

The voice is a **live harbor input**, not files: the app streams each rendered segment — talk
breaks, station sign-ons, podcast episodes — to Liquidsoap's `input.harbor` mount (`HARBOR_PORT`,
default 8005, published on localhost) over the Icecast source protocol, and the bed ducks under it
while a push is connected. This replaced an earlier file-drop playlist that relied on inotify,
which doesn't fire across Docker Desktop for Mac's bind mount, so no segment ever aired.
`HARBOR_PASSWORD` is a DB-seeded secret shared between the app (push) and Liquidsoap
(auth); like the Icecast passwords, restart Liquidsoap once to adopt it if the container
first started on the committed `radio.default.env` dev default.

The **duck** is ours, not `smooth_add`'s: `radio.liq` ramps a gain ref on the bed while the
harbor source is ready, and `add`s the voice on top. `smooth_add` fades the bed down but never
back up ([#3714](https://github.com/savonet/liquidsoap/issues/3714)). Depth and ramp are
`DUCK_GAIN_DB` / `DUCK_FADE_MS` in `radio.env`, read at startup, so tuning them by ear needs a
Liquidsoap restart.

## Playout: the app pushes, Liquidsoap plays

The station owns the running order whichever source the tracks came from, and the app hands it
over one item at a time. `radio.liq` registers four endpoints **on the harbor port** (8005 — harbor
dispatches by path, so they sit beside the `dj` mount), all gated on `PLAYOUT_BRIDGE_SECRET` in
an `X-Playout-Secret` header:

| Endpoint | What it does |
| --- | --- |
| `GET /control/status` | the reading (below) — also the app's reachability probe |
| `POST /control/push` | body is an `annotate:` uri; queues it, returns `{"rid": n, …reading}` |
| `POST /control/flush` | drops everything queued; what is on air finishes |
| `POST /control/skip` | ends what is on air; the queue advances to the next item at once |

Every one of them answers with the same **reading** of the queue, so a mutation's own response is
already the state it produced:

```json
{ "queued": 1, "ready": true, "onAir": "b3f1…", "remainingMs": 92500 }
```

| Field | Meaning |
| --- | --- |
| `queued` | requests waiting, excluding the one on air (pending **and** prefetch-resolved) |
| `ready` | whether the queue can produce audio at all; `false` means the mount has fallen through to another bed |
| `onAir` | rundown item id of the request playing, `""` when not producing |
| `remainingMs` | how much of it is left; `-1` when nothing is on air or the decoder can't say (never `0` — `remaining()` uses `0` for "no item", which the app would otherwise read as a real measurement) |

Only `queued` used to be reported, and the app paid for that: it had to deduce whether an item had
started from the depth dropping, guess when one ended (nothing announces that), and extrapolate the
playhead from when an HTTP notify happened to arrive. `ready`/`onAir`/`remainingMs` turn all three
back into measurements — see `Rundown.reconcile` (apps/api, modules/playout). The app treats a
missing `ready` as "this container is on an older script" and falls back to the old inference, so
the two halves can be deployed independently.

`skip` is the one command about the item already playing: the decoder lives here, so an operator
skip in the console has to come through as a request to Liquidsoap. The app pushes the lead item
first, so the skip lands on something already resolved rather than on an empty queue.

`PlayoutPusher` (apps/api, modules/playout) keeps the queue **one item deep beyond the one on
air**, reconciling against what `status` reports rather than trusting what it pushed — so a
Liquidsoap restart recovers on its own within a couple of seconds, with no app restart. It finds
the container by probing `liquidsoap:8005`, then `127.0.0.1:8005`, keeping whichever answers
(`LIQUIDSOAP_CONTROL_URL` pins one).

The other direction is `POST /playout/aired`, Liquidsoap's `on_track` notify: an item is pushed
(and downloaded) an item before it airs, so that notify is the only thing that knows what the
listener is actually hearing *the moment it changes*. It is still worth having alongside the
reading — a push beats a two-second poll to the boundary — but it is no longer the only thing
that knows, which is what makes a dropped one recoverable. (In the previous incarnation, rendered
break audio was fetched from `GET /playout/segment/:id` with a one-time token, because Liquidsoap
sends no headers on a request it resolves. There is no render pipeline here, so nothing serves
that route: every item in the running order is a track.)

Probe it from the host with the secret out of `.docvol/streamconfig/radio.env`:

```bash
curl -s -H "X-Playout-Secret: $SECRET" http://127.0.0.1:8005/control/status
```

This replaced a pull (`GET /playout/next`, driven by `request.dynamic`), which asked an item
ahead of air and could not be taken back once it had resolved.

By default the music bed is the local, rights-cleared `stream/music/` library
(`MUSIC_DIR=/music`). A configured source plays through the running order above; the local library
is what the mount falls through to when the queue is empty.

## Spotify playout (the track shim)

Real Spotify audio on the stream, personal/local use only — this is against Spotify's ToS for
public broadcast.

`stream/spotify-shim` is a small Go service built into the Liquidsoap image. It serves **one track
per HTTP request**: `GET /track/{id}?t=<signed>` fetches and decrypts the track from Spotify and
returns it as plain Ogg Vorbis. The app resolves each rundown item to a signed URL on it, pushes
that into the queue, and Liquidsoap downloads it ahead of air — exactly what it does with any other
pre-signed stream URL.

That is the whole point: the station **owns each track before it airs**. A skip is
`POST /control/skip` and lands at once, the playhead is the decoder's own reading rather than
wall-clock arithmetic, and a DJ break is an item in the running order. The station used to run
go-librespot as a Connect device and read its raw PCM through `input.external`, which meant it
could only steer playback from the outside: seconds of audio were already committed to that pipe
at any moment, so a skip had to wait them out.

**Requirements:** a Spotify **Premium** account, and the Spotify plugin connected in the console
(Plugins → Spotify → Connect).

### 1. Build the image

```
docker compose build liquidsoap
```

The first build clones go-librespot at a pinned tag and compiles the shim against its packages (a
few minutes); it's cached after. Bump `GO_LIBRESPOT_VERSION` in `stream/Dockerfile` deliberately —
the shim is built against that tag's internals, so a bump is a real compatibility event.

### 2. Log in via the console (no separate Spotify login)

The shim bootstraps its login from the account you already linked in the console. On its first
fetch it asks the app's **internal, secret-gated login route**
(`GET /playout/spotify/session-login`, JSON) for a username + access token and opens its own
session with them. The token flows machine-to-machine and is never shown in the browser. No Connect
device is registered.

That secret needs **no manual setup**: on first boot the app seeds a strong random
`stream.spotifyLoginSecret` in the DB (alongside the Icecast/harbor secrets, see
`ensureStreamSecrets`), validates the shim's `X-Spotify-Login-Secret` header against it, and
materializes the same value into `radio.env` as `SPOTIFY_LOGIN_SECRET`.

The session is built **lazily** on the first track fetch and rebuilt after a failure — the
container comes up before the app that mints credentials, a station playing another source never
needs a Spotify login at all, and the only reliable signal that a session has gone is a fetch
failing on it.

### 3. Play something

In the console: **Playlists**, then play one of the Spotify plugin's playlists. That fills the
running order and the pusher hands it to Liquidsoap an item ahead of air.

The first time you do this after building the image, restart Liquidsoap once so it adopts the
app-rendered `radio.env` (which holds the bridge secret):

```
docker compose up -d --build liquidsoap
```

### 4. Check on it

The shim publishes a health endpoint and logs every track it serves:

```bash
curl -s http://127.0.0.1:3679/health
tail -f .docvol/streamlogs/spotify-shim.log
```

`{"ok":true,"session":false}` before the first fetch is correct — that is the lazy login. To pull a
track by hand, sign a URL inside the container (the exec does **not** inherit the entrypoint's
sourced `radio.env`, so source it):

```bash
docker compose exec -T liquidsoap sh -c 'set -a; . /streamconfig/radio.env; deadair-shim -sign <track-id>'
```

## Verify Icecast

The Icecast image ships no HTTP client, so probe from the host:

```
curl http://127.0.0.1:8000/status-json.xsl
```

## Liquidsoap version (and what to check after a bump)

`stream/Dockerfile` pins the base image; it is currently `savonet/liquidsoap:v2.4.5`, up from
v2.2.5. 2.4 buys async source callbacks (the playout `on_track` notify runs off the streaming
loop), `normalize_track_gain`, and `request.queue`'s script-level `push`/`set_queue`/`length`
methods (which the push model is built on), and it is BREAKING in two places
`radio.liq` touches: callbacks moved to source methods, and the `annotate` protocol now checks
nested static uris.

The base's Debian release used to matter as much as the Liquidsoap version, because the
go-librespot daemon was a CGO build whose codec sonames move between releases. The track shim that
replaced it is CGO-free, so the builder stage and the runtime no longer have to agree on anything
but the Go toolchain.

Rebuild and syntax-check before running anything:

```bash
docker compose build liquidsoap && docker compose run --rm --entrypoint liquidsoap liquidsoap --check /radio/radio.liq
```

`--check` type-checks the script without opening a mount, so it catches renamed arguments and
missing operators for free. It does not tell you whether an operator still behaves the same, so
also read the signatures off the image itself rather than the docs site:

```bash
docker compose exec liquidsoap liquidsoap -h request.queue
```

`request.queue` (the playout bed), `harbor.http.register.simple` (the control endpoints), and
`add`/`amplify` (the duck) are the ones worth reading. Two behaviours the app depends on: `q.length` counts both the pending and the resolved
queue and EXCLUDES what is on air (that is the depth the pusher tops up against), and `add` mixes
only the sources that are ready and is ready when any of them is (that is what lets a
disconnected harbor contribute nothing instead of failing the mix).

Then a live run, in this order: the ident floor with an empty queue, the push path (the console's
now-playing must match what you hear, boundary after boundary), and `docker restart
deadair-liquidsoap` to confirm the pusher refills on its own.
