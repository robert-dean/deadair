# apple-player

Serves ONE Apple Music record per HTTP request, as a plain FLAC file, captured in real time from
Apple's own web player.

This is `stream/spotify-shim` with a browser where go-librespot is. The app fetches each record from
here — not Liquidsoap, since the player is handed `/playout/audio/{sourceId}` for every record and
`TrackAudioService` is the only thing that ever asks a provider for audio — and the player downloads
it from the app ahead of air. Same signed URL, same bridge secret, same place in the chain.

## What it is, mechanically

A container holding four things and a hundred lines of glue:

1. **Google Chrome**, headful, on an Xvfb framebuffer nothing displays. Google's build and not
   Chromium, because only Google's ships the Widevine CDM; headful because **the CDM does not work in
   headless Chrome** ([crbug 40551636](https://issues.chromium.org/issues/40551636)) and stubbing EME
   does not help, since the API talks to the real CDM binary.
2. **`music.apple.com`**, which is itself a MusicKit JS application. Its own `MusicKit.getInstance()`
   is what gets driven, so this container holds **no developer token** — the page's own is used, the
   way every desktop Apple Music client does it.
3. **A PulseAudio null sink**, whose `.monitor` is a perfect copy of what was played.
4. **ffmpeg**, recording that monitor to a file.

Apple's CDM decrypts inside Apple's own player, and what reaches ffmpeg is audio. That is the whole
difference between this and the decryption path every Apple Music downloader takes: no Widevine device
key, no extracted CDM, nothing reverse engineered. It is the software equivalent of a cable from the
line-out to the line-in, and it is why this exists in this form rather than the faster one.

**It is real time.** A four-minute record takes four minutes. That is the cost of the design and it is
not optimisable away: this is a recording of a performance. `TrackCachePlanner` already warms records
ahead of air, and one browser plays one record at a time, so a cold hundred-record rotation is about
seven hours of wall clock before the pool is warm. Every record is captured once and cached after. Which is why the plugin
that fronts this container must send `ProviderStream.fetchBudgetMs` — the station's own fetch ceiling is
90 seconds, sized for a download, and a record captured in real time is cut off mid-song without it.
`fetchBudgetFor` in `TrackAudioService` is the clamp on the other side.

## What is proven, and what is not

Measured on 2026-09-20, arm64, `deadair-apple-player:test`, **with no Apple Music subscription and
nobody signed in**. The numbers are what the container reported, not estimates.

| | |
| --- | --- |
| Chrome, Xvfb and the CDM | **Proven.** `/widevine` → `{"available":true,"keySystem":"com.widevine.alpha"}`. The Widevine CDM works headful under Xvfb in this container, on arm64. |
| The sink, ffmpeg, the file | **Proven.** `/selftest` → 42,736 / 54,306 / 23,729 bytes of FLAC across three runs, from a tone generated in the browser. |
| `MusicKit.getInstance()` on the live page | **Proven.** MusicKit **3.2636.0**, storefront `us`, reachable exactly where the recorder expects it. This was the likeliest thing to be wrong and it is not. |
| Driving it by catalog id | **Proven.** `setQueue({ song: '1440653203' })` resolved, and the player reported `title: "Roads"` — the right record. |
| The capture, end to end | **Proven.** 6,518,719 bytes of FLAC, `durationMs: 90000`, in 96.1s of wall clock. Real audio (6.5MB is right for 90s of 44.1/16 stereo FLAC, where silence would be a fraction of it), real time, and the capture stopped when the audio did rather than at its ceiling. |
| The end-of-record state machine | **Proven** against a scripted player (`tests/player.test.ts`) and, for the ordinary path, live: 96s of wall clock for 90s of audio is the completed state firing, not the 150s ceiling. |
| The signed-URL scheme | **Proven.** `tests/token.test.ts` pins the same vector as the app's suite and the Go shim's, so all three agree byte for byte. An unsigned fetch answers 401. |
| Surviving a restart | **Proven, after a fix.** See *What running it actually found* below. |
| **That a subscriber gets the whole record** | **Not proven, and it is the only thing left.** 90,000ms is Apple's preview length for an unauthenticated session. Everything above it in this table is the same code path for a subscriber; what changes is how much audio arrives. |

## What running it actually found

Three things, and none of them were visible from reading the code.

1. **The recorder cannot be installed at boot.** An install fired 14ms after Chrome came up answered
   `no MusicKit instance on this page`, because the web player's own bundle had not run yet — and a
   container that installed once would have been permanently unable to play anything for a reason that
   had already gone away. `PlayerHandle.ensure` now installs on demand, on every fetch and every
   `/health`, and `main.ts` says out loud that its boot-time attempt is only a log line.
2. **`docker restart` left it permanently broken.** Xvfb's lock and PulseAudio's runtime directory
   survive inside the container, so both refused to start, Chrome had no display, and the supervisor
   looped on a container Docker reported as `Up`. That matters because `restart: unless-stopped` is how
   this is meant to come back: without the two `rm` lines now at the top of the entrypoint, the only
   recovery was to delete and recreate it. Verified fixed — a restart now comes back with the CDM, the
   sink, the recorder and a working `/selftest`.
3. **A record MusicKit cannot resolve looked like a server fault.** `setQueue` throws
   `MKError: [mk-007] NOT_FOUND; One or more items could not be resolved`, which reached the app as a
   502 and would have had the station retry a dead binding until four failures benched it. It is
   classified now and answers 410, which writes the copy off at once.

Chrome's own stderr is filtered (`isChromeNoise`), because dbus and GCM errors in a container with no
desktop were most of the log and pushed the four lines that matter off the end of `docker logs`.

## Verifying it

Nothing here needs an Apple Music account.

```bash
docker build -f stream/apple-player/Dockerfile -t deadair-apple-player:test .
docker run --rm -d --name apple-player-test --shm-size=1g -p 127.0.0.1:3680:3680 \
    -e PLAYOUT_BRIDGE_SECRET=s3cr3t deadair-apple-player:test
```

Then, in order of what each one rules out:

```bash
curl -s localhost:3680/widevine   # {"available":true,"keySystem":"com.widevine.alpha"}
curl -s localhost:3680/selftest   # {"ok":true,"bytes":…,"verdict":"audio reached the sink"}
curl -s localhost:3680/health     # every precondition separately, including whether anyone is signed in
```

`/widevine` false means this container will never play a record, whatever else works. `/selftest`
answering `ok` with a file too small means Chrome is playing into a sink that is not the one being
recorded, which is the failure that most looks like success — a valid file of digital silence.

## Signing in, once

The browser holds the session, so there is **no Music User Token to paste** and nothing to re-paste
every six months. The operator signs in inside this container's Chrome and the profile on `/state`
keeps it — exactly as the Spotify shim's own authorization survives restarts on the streamstate volume.

Reaching a browser that has no display is what `x11vnc` in the image is for. It is shut unless asked
for, it **refuses to start without a password**, and its port is not published by default, so opening
it is three deliberate steps and closing it again is two.

```bash
# 1. Publish the port: uncomment `- '127.0.0.1:5900:5900'` in the apple-player service.
# 2. Turn the door on, with a password of your choosing:
APPLE_PLAYER_VNC=1 APPLE_PLAYER_VNC_PASSWORD='something' docker compose --profile apple up -d apple-player

# 3. Connect to 127.0.0.1:5900 with any VNC client (on macOS: open vnc://127.0.0.1:5900),
#    sign in to Apple Music in the Chrome window, and confirm:
curl -s localhost:3680/health    # → "authorized": true

# 4. Shut the door again: re-comment the port, drop the two variables, and restart.
docker compose --profile apple up -d --force-recreate apple-player
```

Verified on 2026-09-20: with `APPLE_PLAYER_VNC=1` and no password the log says
`refusing to start VNC: APPLE_PLAYER_VNC=1 but APPLE_PLAYER_VNC_PASSWORD is empty` and no port opens;
with a password the port answers `RFB 003.008` and offers **security type 2** (VNC authentication)
rather than type 1 (none), and `/health` keeps working alongside it.

Why a password is required rather than offered: x11vnc has to bind `0.0.0.0` inside the container for
a published port to reach it at all (`-localhost` binds the container's own loopback, which Docker's
port forwarding does not arrive on), so an unauthenticated door would let anything else on the
container network drive the browser that holds the operator's Apple Music session.

The alternative, for a developer in a hurry: drop a Chrome profile that is already signed in onto
`/state/profile`. Fast, and fragile across Chrome versions.

Until somebody signs in, `/health` answers `authorized: false` and `/track` refuses every record,
which is the honest state rather than a broken one.

## Endpoints

```
GET /widevine         → {"available":true,"keySystem":"com.widevine.alpha"}
GET /health           → every precondition separately: CDM, sink, recorder, authorized, signing
GET /selftest         → capture a generated tone and say what came back
GET /track/{id}?t=    → one record, as audio/flac
```

`GET /track/{id}` is the only one the app calls, and its statuses are agreed with `TrackAudioService`
rather than chosen here:

- **200** with `content-type: audio/flac` and a `Content-Length`. The capture is written to a tmpfs
  file first and served whole, because a status code has to be chosen before the first byte and
  whether a record plays is not known until it has. Streaming would mean answering 200 and then
  discovering Apple will not play this one, which reaches the app as a truncated file rather than as
  the 410 that writes the copy off.
- **410** — Apple will not play this record here (restricted, unavailable, gone). The app turns this
  into `UnplayableCopy` and stops asking about the binding.
- **502** — anything else: a stall, a browser having a bad day, a player that never started. The app
  backs off and retries, and four of these bench the copy on their own.
- **401** — the token did not verify. The reason is in the body and logged.

## Config

From the process env, which the compose service names and a full stack sources from `radio.env`:

| | |
| --- | --- |
| `PLAYOUT_BRIDGE_SECRET` | signs `/track/{id}`; the same secret the Spotify shim verifies and the one gating `/control/*`. **Refuses to start without it** — a player that cannot verify a signature and serves anyway is a public Apple Music proxy |
| `APPLE_PLAYER_PORT` | listen port, default `3680` |
| `APPLE_PLAYER_SINK` | the null sink to record, default `deadair`; must match `pulse-default.pa` |
| `APPLE_PLAYER_FORMAT` | `flac` (default) or `mp3` |
| `APPLE_PLAYER_PAGE` | the page to drive, default `https://music.apple.com/us/browse`. A storefront-specific entry goes here |
| `APPLE_PLAYER_PROFILE` | the signed-in Chrome profile, default `/state/profile` |
| `APPLE_PLAYER_SLACK_MS` | how much longer than its own duration a record may take, default 60s |
| `APPLE_PLAYER_QUEUE_MS` | how long a fetch waits for the one browser, default 15 minutes |
| `APPLE_PLAYER_VNC` | `1` opens the once-per-install sign-in door. Anything else (the default) leaves it shut |
| `APPLE_PLAYER_VNC_PASSWORD` | required when the door is open; the player refuses to start VNC without it |

## Why FLAC by default

What comes off the sink is PCM the browser already decoded from Apple's 256kbps AAC. Encoding that to
mp3 would put a second lossy generation on every record the station owns, permanently, to save disk on
a machine whose cache ceiling is already the operator's own setting. FLAC adds none — the file is
exactly what the player produced — and a four-minute record is about 35MB, comfortably inside
`MAX_TRACK_BYTES`. `APPLE_PLAYER_FORMAT=mp3` is there for an operator who would rather have the disk.

**The capture is not trimmed.** Leading and trailing silence is what `analysis/` measures cue points
for, on every provider's audio equally, so trimming here would be a second opinion in the wrong place
— and `silenceremove` cannot tell a quiet intro from a gap.

## If the recorder cannot install

`/health` reporting `recorder: false` means `window.MusicKit.getInstance()` was not reachable on the
page, which is the one assumption in this container that Apple can invalidate without notice. It is
recoverable rather than fatal, and the fallback is already costed: serve a page of our own that loads
`https://js-cdn.music.apple.com/musickit/v3/musickit.js` and configure it with a developer token, which
is the credential the catalog half of the plugin already needs. That trades "no token in this
container" for "a page we control", and it is the right trade to make the day the tap breaks rather
than before.

## What to look for

1. **`/widevine` says available.** Everything else is downstream of it.
2. **`/selftest` comes back with a file of the right size.** A few hundred bytes is a container holding
   nothing.
3. **A record arrives in about its own duration.** Much faster means the capture stopped early; much
   slower means a stall the ceiling caught.
4. **It plays, and the whole record is there.** The end-of-record decision is the one this container
   gets the most chances to get wrong, and every wrong answer is silent.
5. **A restricted record answers 410 rather than 502.** The difference decides whether the station
   writes the binding off or retries it forever.
