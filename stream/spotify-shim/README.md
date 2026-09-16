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
| `SPOTIFY_SHIM_SECRET` | gates `POST /session`, `POST /authorize` and `GET /playlist/{id}`: the first two decide whose account this shim fetches as, and the third reads that account's library |
| `SHIM_ADDR` | listen address, default `:3679` |
| `SHIM_CREDENTIALS` | where the shim keeps its own authorization, default `/streamstate/spotify-credentials.json` |
| `SHIM_CALLBACK_URL` | override the redirect Spotify returns the browser to; defaults to `http://127.0.0.1:<port>/login` |

Note that `docker compose exec` does NOT inherit the entrypoint shell's sourced `radio.env`, so an
exec'd `-sign` has no secret and the server rejects what it mints. Source it in the exec:

```bash
docker compose exec -T liquidsoap sh -c 'set -a; . /streamconfig/radio.env; deadair-shim -sign <track-id>'
```

(And in zsh, do not capture that into a variable called `path` — it is bound to `$PATH`.)

Seven endpoints:

```
GET  /health              → {"ok":true,"session":false,"storedLogin":true,"loginError":"…"}
POST /authorize           ← start this shim's own one-time Spotify authorization
GET  /login?code=         ← where Spotify returns the operator's browser
POST /authorize/complete  ← that same callback, relayed by something that is not that browser
POST /session             ← the app hands over a Spotify login (the fallback)
GET  /playlist/{id}       → one page of a playlist's tracks, as JSON
GET  /track/{id}?t=       → the track as audio/ogg
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

**The browser can only land back here where this port is published to the machine the operator is
sitting at**, which is the compose stack and nothing else. The redirect is
`http://127.0.0.1:<port>/login` and it cannot be moved: the client id is the streaming client's,
which this project does not own and cannot register redirect URIs on, so loopback with any port is
the whole of what Spotify grants it. Pointing it at a station's public address is not an option that
exists.

So on the production container — one published port, and it is the edge's — the operator approves,
lands on a page that cannot load, and the authorization is stranded one step from done. That is what
`POST /authorize/complete` is for. It takes the callback from something that is not that browser:

```bash
curl -sX POST -H "X-Spotify-Login-Secret: $SPOTIFY_SHIM_SECRET" \
    -H 'content-type: application/json' \
    -d '{"redirectUrl":"http://127.0.0.1:3679/login?code=…&state=…"}' \
    http://127.0.0.1:3679/authorize/complete
```

The exchange is unchanged — `state` still ties the callback to the authorization this shim started,
and the same fifteen-minute TTL applies — so this is a second door onto it rather than a way round
it. The whole pasted address is accepted, as is the bare query string with or without its `?`.

The app relays this for the console, which is where an operator actually does it: the plugin page
walks through opening the URL, warns that the page will not load before it happens, and takes the
address back. Nobody should need the curl above.

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

Both callback routes tell two kinds of failure apart, and the relay puts a status on the difference.
Nothing pending, a stale URL, a callback from another authorization and a redirect carrying no code
are all **400**: the attempt cannot succeed and starting again fixes it. The exchange itself failing,
or the login after it, is **502**: Spotify or the network, and pressing the button again is not the
answer to it.

## Build (standalone)

The shim is a `main` package that imports go-librespot's own packages, so build it from a checkout
of the pinned tag:

```bash
git clone --depth 1 --branch v0.7.4 https://github.com/devgianlu/go-librespot /tmp/glr && mkdir -p /tmp/glr/cmd/deadair-shim && cp stream/spotify-shim/*.go /tmp/glr/cmd/deadair-shim/ && (cd /tmp/glr && CGO_ENABLED=0 go build -o /tmp/deadair-shim ./cmd/deadair-shim)
```

That mirrors what `stream/Dockerfile` does: it clones go-librespot at the pinned tag and builds the
shim as one more `go build` in the same stage. Bump `GO_LIBRESPOT_VERSION` deliberately — the shim
is compiled against that tag's internals, so a bump is a real compatibility event.

## Playlists the Web API will not hand over

Since February 2026 the Web API returns a playlist's items only to the account that OWNS it, so a
followed playlist (a friend's, an editorial one, Discover Weekly) answers 403, and the console used
to draw those cards as "Spotify won't share this playlist's tracks." Those rules are written for a
developer app in development mode. This process is not one: it holds the streaming client's own
session, and `/context-resolve/v1/{uri}` is the call a Connect device makes when somebody presses
play on a playlist. So reading one here is the client's ordinary traffic rather than a way around a
rule.

```
GET /playlist/{id}?offset=0&limit=50
X-Spotify-Login-Secret: …

{"id":"6Xc2…","name":"Techno/Coding","owner":"g7u0…","total":2142,"offset":0,"tracks":[…]}
```

Behind `X-Spotify-Login-Secret` rather than a signed token, because the caller is the app and it can
send headers. The HMAC on `/track` exists only because Liquidsoap cannot, and a playlist read is a
read of *this account's* library, which is what that secret is for.

**The playlist is resolved whole, and a page is a window onto that resolve**, kept for two minutes
(`playlistCacheTTL`). The caller that decides this is the library sync, which walks a playlist fifty
tracks at a time: 2142 tracks is 43 pages, and resolving per page would be 43 context reads plus 43
× 22 metadata batches where one of each will do. Two minutes is about as long as one walk takes, and
every other reader in the station reads a playlist live.

**Nothing is filtered out of a page, unplayable tracks included.** A caller pages until it gets a
short page, so a page that quietly dropped two rows would end somebody's walk two thirds of the way
down a playlist. What the station does about a track it cannot play belongs to the fetch, which
answers 410 and lets the caller write that copy off.

Measured on a live account, 2026-09-16:

- **Today's Top Hits** (editorial, owned by `spotify`): 45 tracks, one context page, resolve 62 ms,
  metadata 24 ms, 299 ms end to end including the login.
- **A 2142-track playlist somebody else made**: one context page, 22 metadata batches, resolve
  280 ms, metadata 799 ms, 1.3 s end to end. 0 tracks without metadata, 34 not playable.
- **The name comes back too**, as `context_description`, with `context_owner` beside it.

Two things to know before building on it:

1. **`TRACK_V4` omits `explicit` on most tracks** — 2124 of those 2142, and 32 of the 45. The plugin
   reads an absent advisory as "did not say" rather than as clean, which is the safe reading, but a
   `clean-only` station will draw almost nothing from a playlist read this way.
2. **This is the session the station airs on.** Rate limiting or a protocol change here lands on
   playout, not just on a listing. That is what the cache is for, and why nothing retries in a loop.

Spotify's DJ is the one context that does not resolve: its tracks come from a provider librespot
does not implement, and it answers empty.

### By hand, with no HTTP in the way

`-playlist` resolves one and prints it, which is how the above was measured. `-limit` caps how many
tracks are described, for probing a long playlist without waiting for all of it:

```bash
docker exec -u deadair deadair \
    deadair-shim -playlist 37i9dQZF1DXcBWIGoYBM5M -limit 20 \
    -credentials /data/streamstate/spotify-credentials.json
```

JSON on stdout, and on stderr the three numbers worth reading: the resolve, the metadata, and how
many came back playable. No secret is involved, so unlike `-sign` this needs nothing sourced out of
`radio.env`.

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
