# spotify-shim

Serves ONE Spotify track per HTTP request, as a plain Ogg Vorbis file, with no Connect session.

This is how a Spotify track becomes something the station owns *before* it airs, the way it already
owned a Navidrome one. **The app** fetches each track from here — not Liquidsoap, since the player is
handed `/playout/audio/{sourceId}` for every record and `TrackAudioService` is the only thing that ever
asks a provider for audio — and the player downloads it from the app ahead of air, so `/control/skip`
still lands at once because no audio is committed to a pipe the app cannot take back.

That is also why there is one address here rather than two. A signed URL is valid at whatever address
reaches the shim (the token covers the track id and the expiry, not the host), and the app is the only
thing that fetches one, so `SPOTIFY_SHIM_CONTROL_URL` serves both the session push and the fetch.
`SPOTIFY_SHIM_URL` was the player-facing address and is now only a fallback for an install that still
sets it.

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
| `PLAYOUT_BRIDGE_SECRET` | signs track URLs, which only the app fetches; the same secret gating `/control/*` |
| `SPOTIFY_SHIM_SECRET` | gates `POST /session` and `POST /authorize`, which both decide whose account this shim fetches as |
| `SHIM_ADDR` | listen address, default `:3679` |
| `SHIM_CREDENTIALS` | where the shim keeps its own authorization, default `/streamstate/spotify-credentials.json` |
| `SHIM_CALLBACK_URL` | override the redirect Spotify returns the browser to; defaults to `http://127.0.0.1:<port>/login` |

Note that `docker compose exec` does NOT inherit the entrypoint shell's sourced `radio.env`, so an
exec'd `-sign` has no secret and the server rejects what it mints. Source it in the exec:

```bash
docker compose exec -T liquidsoap sh -c 'set -a; . /streamconfig/radio.env; deadair-shim -sign <track-id>'
```

(And in zsh, do not capture that into a variable called `path` — it is bound to `$PATH`.)

Five endpoints:

```
GET  /health         → {"ok":true,"session":false,"storedLogin":true,"loginError":"…"}
POST /authorize      ← start this shim's own one-time Spotify authorization
GET  /login?code=    ← where Spotify returns the operator's browser
POST /session        ← the app hands over a Spotify login (the fallback)
GET  /track/{id}?t=  → the track as audio/ogg
```

`storedLogin` is the one to read first. `false` means this shim has never been authorized and is
running on whatever the app pushed, which is a login Spotify refuses — see *The login is the shim's
own* below.

`loginError` is the reason the last login attempt was refused, absent once one succeeds. It is the
first thing to read when the station queues tracks and never plays one: a refused login shows up
everywhere else as a fetch that times out, and the reason is several layers down. The same reason is
logged once, at warn, when the login is attempted — never per request, because once the backoff is
set every later request would repeat it a line per track.

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

## The login is the shim's own

**Authorize once, in a browser, and the station never needs a pushed token again.**

```bash
curl -sX POST -H "X-Spotify-Login-Secret: $SPOTIFY_SHIM_SECRET" http://127.0.0.1:3679/authorize
```

That answers `{"authorizeUrl":"https://accounts.spotify.com/…"}`. Open it, approve, and the browser
lands back on this shim, which finishes the exchange, logs in, and writes the result to
`SHIM_CREDENTIALS`. The same URL is logged at info, so it can be read out of
`.docvol/streamlogs/spotify-shim.log` instead. From then on every login uses that file: it survives
restarts, rebuilds and schema resets, because it is the one piece of stream state the app does not
own.

**Why this exists rather than the app's token.** An access token is minted *for* a client. The
client token this shim presents is minted for the streaming client id, and login5 validates the
accesspoint's stored credentials against the client its client token belongs to. A token from the
operator's own Spotify app is a different client, so the pairing is refused however valid each half
is on its own — the accesspoint authenticates, and login5 answers `INVALID_CREDENTIALS` on every
track after it. Measured on 2026-08-10: 208 successful accesspoint authentications, every login5
exchange refused, and the same token answering the Web API throughout. Handing the app's bearer
straight to spclient instead was tried and answers `403`, so both borrowed forms are closed.

What the authorization produces is not an OAuth token to refresh. It is the reusable credential blob
the *accesspoint* hands back, which belongs to the client that asked for it — so the two halves
finally agree, and there is nothing here to renew on an hourly cadence the way an access token is.

**How long that blob lasts is not known, and should not be assumed to be forever.** Spotify began
expiring OAuth refresh tokens six months after the authorization that minted them (new apps from
18 June 2026, existing ones from 20 July 2026), and refreshing does not extend that clock. The blob
is a different credential in a different system, so that rule does not obviously apply to it — but
it is the same company applying the same idea, and nothing published says otherwise either way. Treat
re-authorizing as something an operator may have to do occasionally rather than once. `storedLogin`
stays `true` when the file is merely stale, so `loginError` is what actually reports it.

The pushed login stays as the fallback for a shim nobody has authorized yet, and it is what
`-username`/`-token` feeds in one-shot mode. It is not a working path on its own; it is what the
station had before, kept so that authorizing is a step forward rather than a cutover.

**If the authorization fails.** `POST /authorize` again — starting a second one replaces the first,
which is what an operator who lost the URL wants. A URL goes stale after 15 minutes. The callback
carries a `state` this shim generated and checks, so a stray hit on the published port cannot
complete somebody else's authorization.

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
