# Audio formats: what already works, and the mounts we do not serve

**Written:** 2026-08-09, after adding the brick-wall limiter to the broadcast bus.
**State of the tree:** one `%mp3` mount at `STREAM_BITRATE`. That is the entire output side.

This file is about WHICH mounts to serve. For how good the audio on any of them can get, and why the
ceiling is the source rather than the encoder, see
[stream-quality-ceiling.md](stream-quality-ceiling.md).

---

## Incoming needs nothing

This is worth stating because it looks like a gap and is not. Liquidsoap decodes whatever it
downloads, and the pinned `savonet/liquidsoap:v2.4.5` image is ffmpeg-backed, so every format the
station could plausibly be handed already resolves:

- **Music.** Whatever Navidrome's transcode setting emits for a pre-signed Subsonic URL, or Ogg
  Vorbis from the Spotify track shim (which decrypts rather than decodes, so it hands over Spotify's
  own file untouched).
- **Rendered segments.** `SEGMENT_CONTENT_TYPES` in
  [apps/api/src/modules/render/segment.store.ts](../../apps/api/src/modules/render/segment.store.ts)
  already declares `mp3`, `wav`, `ogg`, `flac` and `m4a`, and the speech capability carries a media
  type alongside the bytes so a plugin's output is labelled rather than sniffed.
- **The local bed.** Anything in `stream/music/`.

**The one sharp edge.** Liquidsoap chooses a decoder from the URL's extension and the response's
content type. A pushed URL carrying neither is the case that fails, and it fails as **silence** —
the request resolves, the queue reports not-ready, and the mount falls through to the local bed. Now
that the starve notify exists (`POST /playout/bridge/starve`) that shows up in the app log instead
of only in a listener's ears, but the cause still has to be guessed. Anything that grows a new way
of handing a URL to the player should make sure one of the two is always present.

## Outgoing is the work

Additional `output.icecast` mounts, each opt-in, all fed from the same `bus`:

| Mount | For | Cost |
| --- | --- | --- |
| Ogg Opus | the browser console and anything modern | an encoder, plus a resample: Opus mandates 48 kHz internally and our bus is 44.1 |
| AAC-LC (ADTS) | hardware and players that decode neither Opus nor high-bitrate MP3 | an encoder, no resample |
| Ogg FLAC | a lossless tier, only meaningful when the sources are themselves lossless | an encoder, ~800-900 kbps per listener |

Per-listener bandwidth is per-mount, so an unused mount costs only its encoder running. That is not
nothing — a second encoder is real CPU in the stream container, 24/7 — which is why each should be
a setting that is off by default rather than something everyone pays for.

### Constraints to build against

- **Bitrates need a parse-time literal int.** `%mp3(bitrate=…)`, `%opus(bitrate=…)` and
  `%fdkaac(bitrate=…)` will not take a ref or a variable. A settings-driven bitrate is therefore a
  branch over a fixed set of values, not an interpolation, and that set has to be kept in step with
  whatever the console offers.
- **Opus costs a resample.** 48 kHz is mandatory in the format, so this mount alone adds a sample
  rate conversion off the 44.1 kHz bus.
- **Ogg mounts need an explicit ICY decision.** `output.icecast`'s default guesses metadata OFF for
  Ogg containers and relies on in-band chained-Ogg re-emission. Several radio clients read the Ogg
  comment header once at connect and then freeze on the first title they saw, while others parse the
  in-band tags correctly and are broken *by* the ICY channel. No single value suits both, so this is
  a per-install toggle rather than a default anyone can pick.

### What is already in place for them

- **The limiter.** `bus` in `radio.liq` sits between the programme and the encoder, so every mount
  added later inherits the -1 dBFS ceiling with no further work. Feed new outputs from `bus`, never
  from `radio`.
- **Labelling.** `insert_metadata`, driven by the app through `POST /control/metadata`, is already
  the single source of stream metadata. A second mount needs no second mechanism — but see the ICY
  note above for whether it will actually reach that mount's listeners.

## Also not built: an archive output

An `output.file` with `reopen_when={0m0s}` writing hourly MP3s of the bus. Cheap to add and useful
for a station nobody was listening to at the time, at the cost of a second encoder running
permanently. It should follow the lease rather than run unconditionally, or it records hours of the
local bed playing to an empty mount.
