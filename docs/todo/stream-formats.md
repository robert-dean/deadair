# Audio formats: what the station serves, and the one output still not built

**Written:** 2026-08-09, when there was one `%mp3` mount and this file was a proposal.
**Rewritten:** 2026-08-28, when the mounts and the HLS output landed. What follows is a record of
what shipped and why, not a plan.
**State of the tree:** MP3 always, plus Opus, AAC and FLAC as opt-in Icecast mounts, plus an opt-in
HLS output carrying AAC and MP3. All four extras are off on a station nobody has configured.

This file is about WHICH outputs the station serves. For how good the audio on any of them can get,
and why the ceiling is the source rather than the encoder, see
[stream-quality-ceiling.md](stream-quality-ceiling.md).

---

## Incoming needs nothing

Worth stating because it looks like a gap and is not. Liquidsoap decodes whatever it downloads, and
the pinned `savonet/liquidsoap:v2.4.5` image is ffmpeg-backed, so every format the station could
plausibly be handed already resolves:

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
the request resolves, the queue reports not-ready, and the mount falls through to the local bed.
Anything that grows a new way of handing a URL to the player should make sure one of the two is
always present.

## Outgoing, as built

| Output | Setting | Default rate | What it is for |
| --- | --- | --- | --- |
| MP3 mount | none, always on | `stream.bitrate` | the compatibility FLOOR. Never switch it off |
| Opus mount | `stream.opusEnabled` | 160 kbps | best quality per bit; browsers and modern players |
| AAC mount | `stream.aacEnabled` | 192 kbps | the one that widens HARDWARE reach |
| FLAC mount | `stream.flacEnabled` | ~900 kbps | lossless transport, behind a lossless library |
| HLS | `stream.hlsEnabled` | AAC 192 + MP3 128 | one URL a player picks from, and the only output that survives a phone changing networks |

The mount PATHS are derived from `stream.mount` by swapping the extension, in `streamMounts`
([stream.settings.ts](../../apps/api/src/modules/stream/stream.settings.ts)), which is the single
place that knows which outputs exist. Four consumers read it — the config renderer, the audience
gate, the edge and the console — and any of them deriving the list separately is how a listener on a
mount nobody counted stops holding the station on air.

**MP3 is the floor and that is a compatibility fact, not a quality one.** A Sonos takes MP3, AAC or
WMA for a manually added radio URL and nothing else ([supported formats](https://docs.sonos.com/docs/supported-audio-formats));
a car head unit and a hardware radio are narrower still. So AAC, not Opus, is the format that widens
reach, which inverts the ordering this file originally proposed.

**Per-listener bandwidth is per-output, so an unused one costs only its encoder.** That is not
nothing — an encoder is real CPU in the stream container, 24/7 — which is why every one of them is
off by default rather than something a station pays for without asking.

### Why HLS is here, and why it carries only two of the four

Not for quality and not for latency (it is worse on both counts than a mount). An Icecast mount is
one long-lived TCP connection, so a phone moving between wifi and mobile changes its source address,
the socket dies, and the stream simply ends with no reconnect. Nothing on the server side carries a
TCP connection across that and no Icecast setting touches it. HLS is a sequence of ordinary HTTP
requests for small files, so the same handoff costs at most one segment fetch and the player asks
again. It is also the only output a player can CHOOSE from: the master playlist advertises each
variant with its `CODECS` and `BANDWIDTH`.

**AAC and MP3 only.** The HLS spec allows mp3 and aac; Opus and FLAC need fragmented MP4, which
Liquidsoap supports since 2.4.3 and which carries **no in-stream metadata at all** — so those
variants would play, on the few clients that manage them, with no idea what is on. They stay on
their Icecast mounts where their metadata works. Sonos reads ID3v2 out of an HLS stream and ICY out
of everything else ([HLS docs](https://docs.sonos.com/docs/http-live-streaming-hls)), which is
exactly what these two produce.

**It runs whenever it is enabled and does NOT follow the mount lease.** The instinct is to write
segments only while the station is on air, and it is wrong: the playlist has to exist before anybody
can tune in, and tuning in is what opens the audience gate. An output that only wrote while on air
could never be listened to. Disk is bounded by `segments + segments_overhead`.

**The app serves the playlists and nginx serves the segments.** An HLS player holds no connection
open, so nothing can be asked how many are listening; a live player must re-fetch the media playlist
every target duration, so a playlist request is a per-client heartbeat that arrives on its own. That
count is load-bearing under `playout.airMode: audience`. The two alternatives were rejected:
`auth_request` in nginx would put the API in the path of every listener's own connection, which is
what `<authentication type="url">` did before it was removed from `icecast.xml`, and counting
entries in an access log is the "zero and unknown are the same number" failure `AudienceWatch`
exists to refuse.

### What the encoders actually needed

Measured on `savonet/liquidsoap:v2.4.5`, 2026-08-28, and each of these cost something to learn:

- **All four encoders are present**, `%fdkaac` included, which its licence usually keeps out of
  builds. `--list-plugins` is NOT a way to check: it lists no `opus` line at all on this image while
  `%opus` works fine. Probe with `ignore(%encoder(...))` in a file, and keep `%mp3` in the list as a
  control, since a broken harness reports every encoder missing in exactly the same way.
- **Opus mandates 48 kHz**, so that mount carries the only resample in the chain. The bus stays at
  44.1 kHz because the music is.
- **FLAC over Icecast is `%ogg(%flac)`**, not `%flac`: the bare encoder writes a FLAC *file*, whose
  header declares a total sample count a stream does not have.
- **Bitrates are a branch over fixed values**, not an interpolation, and the console offers exactly
  that set. `%mp3` genuinely does take a computed one; the others are documented as wanting a
  literal at parse time.
- **The ICY decision is explicit at every mount** rather than left to `output.icecast`'s guess. It
  is `send_icy_metadata : bool?`, NOT `icy_metadata`, which is the list of metadata FIELDS an update
  carries. The Ogg case is genuinely contested — some clients read an Ogg comment header once and
  freeze on the first title, others parse in-band tags and are broken BY the ICY channel — so no
  value suits both and the one in use is a visible line rather than a default to discover.

Everything is fed from `bus`, the brick-wall limiter, and never from `radio`. One output taken off
`radio` skips the -1 dBFS ceiling and hands a listener the inter-sample peaks it exists to leave
headroom for.

### The two Icecast numbers that are counted in bytes

`queue-size` and `burst-size` are byte counts, so raising a bitrate silently shortens both in TIME.
Both are now rendered from the enabled bitrates rather than written as literals; the derivation and
why the two are treated differently is in
[stream-quality-ceiling.md](stream-quality-ceiling.md). Each extra mount also gets its own
`<mount>` block with credentials, because a mount that declares none has nothing to authorise a
mount-scoped `/admin/metadata` against and every ICY title for it is silently refused.

## Still not built: an archive output

An `output.file` with `reopen_when={0m0s}` writing hourly MP3s of the bus. Cheap to add and useful
for a station nobody was listening to at the time, at the cost of a second encoder running
permanently. Unlike the HLS output it SHOULD follow the lease — the argument that keeps HLS running
unconditionally is that a listener has to be able to arrive, and nobody arrives at an archive — so
without that it records hours of the local bed playing to an empty mount.

## What this cost to build, which is the part worth reading

Three failures took the station off air during this work, and every one of them passed the check
that was supposed to catch it. They are recorded properly in
[stream/README.md](../../stream/README.md); the pattern is what belongs here.

**A check that does not exercise the failure mode is not a check.** `liquidsoap --check`
type-checks and evaluates a script and never STARTS an output, so an output that type-checks and
then fails on startup passes it and takes every other output down with it. `hlsout.check.liq` was
written to close that gap and then passed while the real script was broken, because it hardcoded a
bitrate where the real script read an empty variable. **A harness that paraphrases the code proves
nothing about the code.** What found the bug first try was running the actual `radio.liq`, with the
actual rendered environment, redirected onto a spare mount name and harbour port so it could not
touch the live station. That probe is the check worth keeping.

**The three bugs, for the shape of them rather than the detail:** an optional setting arrives as the
empty STRING rather than absent, so `environment.get`'s default never applies and `int_of_string("")`
raises during startup; `^~` on an nginx location means "do not consider regex locations" and so
silently swallowed the playlists it was meant to sit beside, answering 200 off the disk and looking
perfectly correct while no listener was ever counted; and a parameter named `source` shadows one of
Liquidsoap's own namespaces, which is not a type error and surfaces a hundred lines away as
`Warning 4: Unused variable bus`.

Two of the three produced a **correct-looking result**. That is the thing to carry forward: on this
seam, the failure mode is not an error message, it is a station that looks fine and is not.
