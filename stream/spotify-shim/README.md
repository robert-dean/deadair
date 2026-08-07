# spotify-shim

Serves ONE Spotify track per HTTP request, as a plain Ogg Vorbis file, with no Connect session.

This is how a Spotify track becomes something the station owns *before* it airs, the way it already
owned a Navidrome one. The rundown resolves each Spotify item to a signed URL here, Liquidsoap
downloads it ahead of air, and `/control/skip` lands at once — because no audio is committed to a
pipe the app cannot take back.

It replaced go-librespot, which registered as a Connect device and streamed realtime PCM into
Liquidsoap through `input.external`. That arrangement could only be steered from the outside: the
mount ran seconds behind the daemon, and a skip had to wait out whatever was already in flight.

Measured on a live account:

- session up (accesspoint keyexchange + login5 + spclient resolve) in **292 ms**
- an 8.9 MB, ~3½ minute Ogg Vorbis 320 track fetched and decrypted in **664 ms**, about **320×
  faster than it plays**. This is the number the whole design rests on: Liquidsoap has to download
  each item ahead of air, the way it already does a Subsonic stream.
- exactly **167 bytes** trimmed (8,947,560 fetched, 8,947,393 written), which is Spotify's Ogg
  metadata page. The page arithmetic derives that rather than hardcoding it, and the output plays.

Relinking is the weakest path and the one least exercised: the shim takes the first alternative
that has audio files rather than checking the market the way `player.getUnrestrictedTrack` does
(see *What to look for*).

## In the container

`stream/Dockerfile` builds it inside a clone of go-librespot at a pinned tag, whose packages it
imports; the compose entrypoint backgrounds `spotify-shim-run.sh` before it execs Liquidsoap. It is
not an audio source, so nothing in `radio.liq` knows about it — Liquidsoap only ever sees a URL the
app handed it. The app talks to the shim directly on **3679**, published on localhost.

Its config comes from the process env, which the entrypoint sources from `radio.env`:

| | |
| --- | --- |
| `PLAYOUT_BRIDGE_SECRET` | signs track URLs; the same secret gating `/control/*` |
| `SPOTIFY_SHIM_SECRET` | gates `POST /session`, where the app hands over a Spotify login |
| `SHIM_ADDR` | listen address, default `:3679` |

Note that `docker compose exec` does NOT inherit the entrypoint shell's sourced `radio.env`, so an
exec'd `-sign` has no secret and the server rejects what it mints. Source it in the exec:

```bash
docker compose exec -T liquidsoap sh -c 'set -a; . /streamconfig/radio.env; deadair-shim -sign <track-id>'
```

(And in zsh, do not capture that into a variable called `path` — it is bound to `$PATH`.)

Three endpoints:

```
GET  /health         → {"ok":true,"session":false}
POST /session        ← the app hands over a Spotify login
GET  /track/{id}?t=  → the track as audio/ogg
```

`POST /session` takes `{"username","accessToken","expiresAt"}` (unix **milli**seconds, matching the
app's plugin boundary) behind `X-Spotify-Login-Secret`, and answers **202** without waiting for the
login: the caller is the app, mid-resolve, inside a deadline it has to produce a URL within. The
connection is warmed in the background instead, so the fetch that follows a couple of minutes later
finds a session already up. A push naming a different account drops the live session; a refreshed
token on the same account does not, because an authenticated accesspoint does not stop being
authenticated when the token that opened it is renewed.

Liquidsoap fetches a queued item with **no headers from us**, so authorization rides in the query
string, as it already does for the app's rendered-segment route. The token is
`<expiry>.<base64url(hmac-sha256)>` over the track id and that expiry: signed rather than one-time,
because the app and the shim are separate processes and an HMAC needs only the secret both already
hold. The shim refuses to start without one.

The session is built lazily — on a pushed login, or failing that on the first fetch — and rebuilt
after a failure. That is deliberate: the container comes up before the app that mints credentials, a
station in Navidrome mode never needs a Spotify login at all, and the only reliable signal that an
accesspoint connection has gone is a request failing on it. Failures back off so a down app cannot
become a reconnect storm, and a push carrying new credentials clears that backoff, since new
credentials are exactly what a rejected login might have been waiting for.

Until the first push arrives the shim falls back to a `-username`/`-token` pair given on the
command line, which is what makes one-shot mode work with no app in the picture at all.

## Build (standalone)

The shim is a `main` package that imports go-librespot's own packages, so build it from a checkout
of the pinned tag:

```bash
git clone --depth 1 --branch v0.7.4 https://github.com/devgianlu/go-librespot /tmp/glr && mkdir -p /tmp/glr/cmd/deadair-shim && cp stream/spotify-shim/*.go /tmp/glr/cmd/deadair-shim/ && (cd /tmp/glr && CGO_ENABLED=0 go build -o /tmp/deadair-shim ./cmd/deadair-shim)
```

That mirrors what `stream/Dockerfile` does: it clones go-librespot at the pinned tag and builds the
shim as one more `go build` in the same stage. Bump `GO_LIBRESPOT_VERSION` deliberately — the shim
is compiled against that tag's internals, so a bump is a real compatibility event.

## Run one track by hand

`-uri` switches to one-shot mode: fetch a single track and exit, which is how you answer "is this
login working, and is this track fetchable?" without involving Liquidsoap or the app. Nothing
pushes to a one-shot process, so it takes the login on the command line:

```bash
/tmp/deadair-shim -uri spotify:track:4PTG3Z6ehGkBFwjybzWkR8 -username "$SPOTIFY_ACCOUNT_ID" -token "$SPOTIFY_ACCESS_TOKEN" -o /tmp/track.ogg -v
```

Note `-shim-secret` gates `POST /session`; `-secret` is the one that signs track URLs, and neither
is involved here. Then confirm it is real audio:

```bash
ffplay -autoexit /tmp/track.ogg
```

`-sign <id>` prints a signed URL path, so a served track can be curled by hand without recomputing
the HMAC.

## What to look for

1. **It plays.** Anything else means the audio key or the page trimming is wrong.
2. **Faster than realtime.** The shim prints bytes and elapsed time on stderr. A four-minute track
   must arrive well inside four minutes, or Liquidsoap cannot download it ahead of air.
3. **A relinked track.** Try one that is region-restricted in your market. The shim follows
   Spotify's relinking by taking the first alternative that actually has audio files, rather than
   comparing the market against the restriction list the way `player.getUnrestrictedTrack` does:
   the account's country is known to the accesspoint but not exposed to us. A track with no files
   anywhere is reported as unplayable rather than served broken.
4. **An episode or a local file fails cleanly**, rather than producing a broken stream.

## Notes on the implementation

- It does **not** use `session.NewSessionFromOptions`: that returns a `Session` whose `spclient`
  and audio key provider are unexported with no accessors, and Go's unexported is package-scoped,
  so even an in-tree `cmd/` cannot reach them. `connect()` mirrors the parts of that constructor a
  fetch needs and skips the dealer, mercury and the event manager. Nothing here registers a Connect
  device.
- It does **not** import `player` or `vorbis`, which pull in libvorbis/libogg through
  `xlab/vorbis-go`. We never decode: Spotify's file is already Ogg Vorbis once decrypted. That is
  what keeps the build CGO-free.
- Audio keys come from the accesspoint (`audio.KeyProvider`), not PlayPlay. go-librespot ships a
  stub PlayPlay plugin (`IsSupported() == false`) and falls back to this same path, which is what
  the station already runs on today. PlayPlay only gates FLAC.
