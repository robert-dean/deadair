# The quality ceiling: how good could this stream actually be?

**Written:** 2026-08-13, from the question "what's the highest quality of stream we could support?"
**State of the tree:** one `%mp3` mount at `STREAM_BITRATE` (default `128`), fed from a 44.1 kHz
stereo float bus. Nothing in `radio.liq` sets a frame rate, so that is Liquidsoap's default rather
than a decision anybody made.

This is the companion to [stream-formats.md](stream-formats.md), which is about **which mounts** to
serve. This one is about **how good the audio on any of them can get**, which is a different
question with a less flattering answer: the encoder is not the ceiling.

---

## The short answer

**The station cannot sound better than the file it was handed, and today most of those files are
Spotify's Ogg Vorbis 320.** Everything downstream of that either preserves it or spends it. The
present output spends a lot of it: MP3 at 128 kbps is a *second* lossy generation over an already
lossy source, and tandem coding is where the audible damage in this chain is, not in the bitrate
number on its own.

So the honest ceiling, in order of what it buys:

1. **A better final encode** — Opus ~160 kbps, or MP3 320 / AAC-LC ~256 if the client cannot take
   Opus. This is nearly all of the available gain and the only stage the station fully controls.
2. **A lossless mount** — possible, and mostly meaningless while a lossy provider is the main
   source: FLAC of a decoded Vorbis 320 is a ~900 kbps perfect copy of a lossy record.
3. **Lossless *sources*** — which the station already supports and which nobody has to build:
   Navidrome at `streamFormat: 'raw'` hands over the original file, so a FLAC library is a lossless
   source today.

There is one ceiling no mount can lift: **the DJ voice is a 24 kHz model.** See stage 1 below.

## Where quality is actually decided, stage by stage

### 1. The source file, which is the real ceiling

| Source | What arrives | Ceiling |
| --- | --- | --- |
| Spotify, via the shim | Ogg Vorbis, `SHIM_BITRATE` default `320`, nearest available file ([main.go:54](../../stream/spotify-shim/main.go)). The shim decrypts and never decodes, so it is Spotify's own file byte-for-byte | **lossy, hard.** There is no lossless file on this path, and one is not a config change |
| Navidrome | `streamFormat` defaults to `raw`, meaning the server sends the file as stored, with `maxBitRate` deliberately not sent ([navidrome.plugin.ts:237](../../plugins/navidrome/src/navidrome.plugin.ts)) | **whatever the library holds**, FLAC/ALAC included. The one lossless path the station has |
| The DJ voice | Kokoro, an 82M-parameter model that synthesises at **24 kHz mono**, and the plugin asks for `mp3` by default (`DEFAULT_FORMAT` in [kokoro.manifest.ts](../../plugins/kokoro/src/kokoro.manifest.ts)) | **24 kHz, and no output tier changes that.** A lossless mount ships a perfect copy of a narrowband voice |
| The local bed | whatever is in `stream/music/` | operator's own |

Two things fall straight out of this table and neither is a project:

- **Do not set Navidrome's `streamFormat` away from `raw`** unless bandwidth to the app is the
  constraint. It is the only lossless input the station has and the form makes it one click to
  throw away.
- **Kokoro's `format` should be `flac` or `wav`, not `mp3`.** A break is a few seconds long, so the
  bytes are irrelevant, and it removes an entire lossy generation from the voice for free. It does
  not fix the 24 kHz, which is the model.

### 2. The app's copy of the bytes: lossless already

`TrackAudioService` stores what it fetched. Nothing in `apps/api` transcodes audio; `track.store.ts`
only names the file so a decoder can be chosen. This stage costs nothing and needs no work.

### 3. Liquidsoap's internal frame: 44.1 kHz stereo, float

`radio.liq` sets no `settings.frame.*`, so the pipeline runs at the 2.4.5 defaults: **44.1 kHz,
stereo, float PCM internally**. Consequences worth knowing before anybody "improves" it:

- **Bit depth is not a constraint anywhere inside the station.** Everything between the decoder and
  the encoder is float, so the only quantisation in the whole chain is the final encode. The
  per-track `amplify` off the measured loudness, the `normalize(target=-16.)`, the voice chain's
  compressor and the `-1 dBFS` bus limiter are all transparent by design and none of them is the
  ceiling.
- **A hi-res source is downsampled once, to 44.1 kHz.** That is not a loss anybody can hear, and
  raising the frame rate to chase it would resample every ordinary 44.1 kHz record instead. The
  trade only tips if an Opus mount lands: Opus is 48 kHz internally, so it either resamples at the
  mount (default, costs one conversion on one output) or the whole bus moves to 48 kHz (costs a
  conversion on nearly every input). **Keep the bus at 44.1** — the music is 44.1.

### 4. The final encode: where the loss actually is

One `%mp3(bitrate=…)` at 128 by default. This is the single biggest quality decision in the tree and
it is already a setting: `stream.bitrate`, a `string` field in
[settings.registry.ts](../../apps/api/src/modules/settings/settings.registry.ts), rendered into
`STREAM_BITRATE` and adopted on the config-watch restart. Raising it is **zero code**.

| Tier | Bandwidth per listener | What it buys |
| --- | --- | --- |
| MP3 128 (today) | ~16 kB/s | the baseline, and audibly second-generation on cymbals and reverb tails |
| MP3 320 | ~40 kB/s | most of the tandem-coding damage gone; universal client support; nothing to build |
| AAC-LC ~256 | ~32 kB/s | roughly MP3 320 at fewer bits; hardware players like it; needs a second mount |
| Opus ~160 | ~20 kB/s | **best quality per bit by a wide margin**; near-transparent over a lossy source; needs a mount and a resample |
| Ogg FLAC | ~110 kB/s | lossless *transport*. Only meaningful when the sources are lossless |

For a one-operator station, per-listener bandwidth is not a real constraint, which is why the first
row of the plan below is simply a bigger number in a box.

### 5. Delivery: the Icecast numbers are in BYTES, and that is a trap

`icecast.xml.tmpl` sets `<queue-size>524288</queue-size>` and `<burst-size>8192</burst-size>`, and
the comment beside the burst reasons about it in **seconds at 128 kbps** ("8192 B ≈ 0.5s"). Both are
byte counts, so **raising the bitrate silently shortens both in time**:

| | at 128 kbps | at 320 kbps | at ~900 kbps FLAC |
| --- | --- | --- | --- |
| `burst-size` 8192 | ~0.5 s | ~0.2 s | ~0.07 s |
| `queue-size` 524288 | ~32 s | ~13 s | ~4.7 s |

The burst getting shorter is mostly fine and is even a latency win (it is pure backlog, see
[stream-latency.md](stream-latency.md)), but below roughly a tenth of a second players start
raggedly. The queue is the one that bites: it is the slow-client tolerance, and a lossless mount at
the current number drops listeners a 128k mount carried without complaint. **Anything that raises
the bitrate has to re-derive both of these in seconds**, in the same template, or the fault will
present as "the new high-quality mount keeps dropping people".

## The plan, cheapest first

1. **Raise `stream.bitrate` to 320.** One settings edit, no code, no new mount, no new encoder.
   Removes most of the tandem-coding loss and is the largest single improvement available.
   Re-check `burst-size` at the same time (0.2 s is still fine; it is the queue that matters at 320,
   and 13 s is still generous).
2. **Set the Kokoro plugin's `format` to `flac`.** One config field. Removes a lossy generation from
   the station's own voice.
3. **Leave Navidrome on `raw`**, and note in the console help that changing it is a quality
   decision rather than a bandwidth one.
4. **Then the Opus mount** from [stream-formats.md](stream-formats.md), which is where the real
   per-bit gain lives, and which is also the answer to MP3 showing as a generic format in the 2.5
   dashboard. Everything about building it is in that file; nothing here changes it.
5. **FLAC only behind a lossless library.** It is a legitimate tier for a Navidrome-first station
   and a vanity one for a Spotify-first station.

## Verify before building any of it

- **The pinned image's encoders.** `%opus`, `%flac` and especially `%fdkaac` may or may not be
  compiled into `savonet/liquidsoap:v2.4.5` — fdk-aac's licence keeps it out of a lot of builds.
  Check with `docker compose exec liquidsoap liquidsoap --list-plugins` before designing around any
  of them; `%ffmpeg(format="adts", codec="aac")` is the fallback for AAC on an ffmpeg-backed build.
- **Client support, by probe rather than by reputation.** The console's own monitor is an `<audio>`
  element, and the operator's hardware player is the other consumer. MP3 and AAC are safe
  everywhere; Ogg Opus and Ogg FLAC are the ones to actually test in the browsers and on the box
  that will play them. See [now-playing-displays.md](now-playing-displays.md) for the probe habit
  this file is borrowing.
- **The bitrate is fixed at script load.** Today's `%mp3(bitrate=int_of_string(environment.get(…)))`
  resolves once when Liquidsoap evaluates the script, which is why a settings change is adopted on
  the `config-watch.sh` restart rather than live. It cannot become a `ref` that moves under a running
  encoder. [stream-formats.md](stream-formats.md) states this harder (a fixed set of literals) for
  `%opus` / `%fdkaac`; check the actual behaviour per encoder before assuming either version.
- **Nothing about measurement changes.** The analysis sidecar reads the source file, not the mount,
  so cue points and loudness are unaffected by any of this.
