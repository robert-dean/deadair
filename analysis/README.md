# The analysis sidecar

Measures one track's audio and answers with offsets: where the record actually starts, where it is
underway, where the ending begins, where it stops. The station reads those to trim dead air off the
head and tail of every record, to know how long it may talk over an intro, and later to size a blend
between two records.

It also **joins** several files into one, which is the same work seen from the other end: both need
decoded PCM, and decoding is the one thing that does not happen in Node.

**This directory is one implementation of the contract below, not the contract itself.** Anything
that answers these endpoints is a valid analyzer, and swapping to it is a `baseUrl` change in the
plugin's config. That is the whole reason the boundary is HTTP. `/join` is optional in that contract:
a station whose sidecar answers 404 to it keeps every other thing an analyzer does, and the plugin
turns that 404 into an `unsupported` the station degrades over rather than a fault.

App-side those are two CAPABILITIES — `analysis` and `mixer`, with their own keys — while remaining
one sidecar behind one plugin declaring both. The split is about which plugin the host PICKS for
each job, not about which program does the work; `packages/plugin-sdk/src/capabilities/mixer.ts`
argues it.

## Why it is a separate program

One reason, and it is worth knowing which one, because an earlier draft of this section gave two.

**Decoding does not happen in Node.** Every field here comes from PCM samples rather than from a
container, and the API server is the one place the station's architecture says audio does not go. A
CPU-bound decode loop inside the request path would be a decision nobody made. If this container is
ever "simplified" back into app code, that is the thing being given up, and it will not be visible in
the diff.

**It is not here for licence reasons**, which is the half that was wrong. The second reason used to
be that a separate program speaking HTTP is a materially different position from linking a copyleft
toolkit into the API process. True, and irrelevant:
[`docs/decisions/analysis-licensing.md`](../docs/decisions/analysis-licensing.md) decided that
nothing copyleft or non-commercial enters the analysis path at all, weights included, so the boundary
never has to carry that weight and must not be spent as if it could. Today's dependencies are a
decoder invoked as a binary and two permissively licensed array libraries; the beat layer's will be
permissive too, or it will not be pinned.

## The contract

### `GET /health`

Cheap. Does no work, decodes nothing.

```json
{ "status": "ok", "schemaVersion": 1, "analyzer": "deadair-analysis/0.1.0", "maxConcurrent": 4, "rssMb": 118.4 }
```

Two callers, two purposes. The plugin's connection test uses it so the console can say "not
reachable" before any track is queued. And it is where an operator sees a **schema mismatch**: an
analyzer answering a version the host does not know is a configuration error worth reporting, not a
reason to write rows nothing can read.

`maxConcurrent` is the decode ceiling — see `ANALYSIS_WORKERS` below. It is reported rather than
enforced on the caller: the station repeats it on the connection test so that asking for more than
this is visible, since the alternative is a walk that got no faster and nothing anywhere saying why.

`rssMb` is this process's resident memory right now, and it is the only field here that moves between
two calls. It is reported because a process that decodes whole records accumulates resident memory
the allocator does not return — independent of any leak — and the symptom of that is a container
killed hours later with nothing to attribute it to. Nothing acts on it; it exists so there is a
baseline to compare against when the measurements get more expensive. **Optional**, and omitted off
Linux rather than faked: `resource.getrusage` looks like the portable answer and reports the PEAK
rather than the current figure, in kilobytes on Linux and bytes on macOS.

### `POST /analyze`

```jsonc
// request
{
  "url": "https://…",     // complete and self-authenticating; this service fetches it
  "durationMs": 214000    // optional, the catalog's claim, used only as a truncation cross-check
}
```

```jsonc
// response, 200
{
  "schemaVersion": 1,
  "analyzer": "deadair-analysis/0.1.0",
  "complete": true,
  "durationMs": 213880,
  "data": {
    "cueIn": 180,
    "introEnd": 12400,
    "outroStart": 198200,
    "cueOut": 213600,

    "vocalCurve": [0, 0, 4, 31, 44, …],  // 0-100 every 500 ms, from the start of the FILE
    "vocalOnset": 18600,      // absent on an instrumental; see below

    "integratedLufs": -8.4,   // gated programme loudness, BS.1770
    "truePeakDb": 1.2,        // oversampled; legitimately above 0
    "samplePeakDb": -0.1,

    "tagGainDb": -9.6,        // what the FILE's own tags ask for
    "tagReferenceLufs": -18,  // and what that gain is relative to
    "tagPeakDb": -0.1         // a SAMPLE peak, by ReplayGain's definition
  }
}
```

Every offset in `data` is absolute, into the file, in integer milliseconds — `cueOut` included.
Storing it relative to `cueIn` is the obvious-looking choice and is wrong: everything downstream seeks
in file time, so a relative figure has to be re-based at every read and eventually one read is not.

`vocalCurve` is **always produced** and `vocalOnset` is not, and that asymmetry is load-bearing in two
places. It is what tells a reader an instrumental (a curve, no onset) from a record nothing has
looked at yet (neither) — an instrumental is a real answer rather than a miss. And it is what the
station's own walk uses to find rows written before this layer existed, which is why no schema bump
was needed for it.

The three loudness fields are **optional and omitted rather than floored**. A silent or near-silent
track has no loudness, and the alternative to leaving it out is a value like −80 that a caller would
then "correct" by fifty decibels. Absent means no opinion, which every consumer already handles.

The three `tag*` fields are **what the file claims, not what this service measured**, read off the
container's own ReplayGain or R128 tags in the same ffprobe that reports the channel count. Most
files carry none of them. `tagGainDb` is meaningless on its own, which is why `tagReferenceLufs` is
always reported beside it: a gain is a correction relative to some level, R128 fixes that level at
−23 LUFS and ReplayGain is assumed to mean −18, and the two are five decibels apart. Subtracting the
pair gives the loudness the tagger believed the record has. Album gain is deliberately not read — the
station plays records in an order nobody sequenced — and `tagPeakDb` is a sample peak, so nothing
should cap a boost with it when `truePeakDb` is right there.

`data` is stored by the host as an opaque blob under `schemaVersion`. That is what lets a later
version add a tempo, a downbeat grid or a vocal curve without touching the plugin, the host or the
database. Adding an OPTIONAL field does not bump that version: every consumer already has a defined
answer for one being absent, so a row written before the field existed is a correct row of this
version rather than a stale one. The `tag*` fields arrived exactly that way. A row measured before
them keeps its measured loudness, and re-measuring the catalog is how it picks them up.

Synchronous, deliberately. The caller is a background walk with its own time budget and its own
concurrency setting, so nothing is waiting on the response and a job-id-plus-polling protocol would
buy state in this service for no gain. Expect a request to take on the order of seconds per track.

#### One fetch per track, and it is deliberate

The audio is downloaded once, to a temp file, and ffprobe and ffmpeg then read that file locally.
The obvious alternative — hand the URL to both and let them stream it — was what shipped first, and
it cost **eight HTTP requests for one nine-megabyte track**, measured against the real track fetcher.
A container format wants its header and its trailer, so each tool opens and seeks, and every one of
those requests crosses the provider's rate limits on the same credential the station plays on.

That also makes `complete` answerable directly: bytes received against `Content-Length` catches a cut
transfer exactly, where a duration comparison only catches one big enough to shorten the decode. Both
checks are applied, because neither subsumes the other — a preview clip arrives complete and is still
not the track.

#### `complete` is load-bearing and only this service can answer it

The host hands over a URL and never sees the bytes, so it cannot tell a whole download from a
truncated one. A capped or interrupted fetch produces perfectly confident measurements of a file that
was never the track, and the specific lie it tells is that a record which fades ended cold — which is
exactly the case the measurement exists to serve.

So this service reports it, and the host filters on it. An implementation that always answers `true`
has silently disabled the check. A genuinely short track is `true`; a download that stopped early is
`false`, told apart using `durationMs` where the caller supplied one.

### `POST /join`

```jsonc
// request
{
  "parts": [                 // in the order they are to be heard
    { "url": "https://…" },  // each complete and self-authenticating, as /analyze's is
    { "url": "https://…" }
  ],
  "gapMs": 200,              // silence BETWEEN the parts. 0..2000, default 200
  "trim": true               // take each part's own leading and trailing silence off first
}
```

```
// response, 200
Content-Type: audio/flac
X-Duration-Ms: 184320

<the audio>
```

The one endpoint here that answers audio rather than JSON. Errors take the same shape as
`/analyze`'s, so a caller has one failure vocabulary for the whole service.

#### What it is for

A production — a phone-in, a podcast, a long bulletin — is written one beat at a time, because a beat
is one model call in one voice. It used to AIR that way too: seven turns of a three-minute call were
seven items in the station's running order, seven hand-overs to the player, and the pause between one
turn and the next was the speech engine's own padding plus whatever the transport added. Nothing
could tune it, because there was nothing between the beats to tune. Joining them makes that pause a
number.

#### Why `trim` is on by default

A gap inserted between two files that each carry a few hundred milliseconds of engine padding is not
a gap of `gapMs`; it is `gapMs` plus two unknowns that move with the voice and with the line. So each
part is trimmed to its own `cueIn..cueOut` first, with the same −60 dBFS floor described under the
four points — chosen to sit below a quiet transfer's noise floor precisely so a trim does not clip an
attack. A part that measures as silence all the way through is kept whole rather than trimmed to
nothing: a beat of room tone is still a beat somebody wrote.

The silence goes **between** the parts and never at the ends, which is the same rule read twice: what
comes back is one item in a running order, and padding its head would put back exactly the dead air
the trim just removed.

#### FLAC, and the ceiling behind it

The answer is FLAC because it is lossless — no turn is taken through a lossy step on its way into the
programme — and because it is about half the size of the equivalent wav. That is not tidiness: the
station caps a plugin's response body at 64 MB, which 48 kHz wav reaches on a feature-length
production.

Every part is decoded at the same channel count, the widest any of them claims, so a mono turn beside
a stereo one is widened rather than the stereo one folded. A join longer than `ANALYSIS_MAX_SECONDS`
is refused rather than cut: answering with the first half of a programme would air as one. So is one
of more than 64 parts, which is a mistake upstream rather than a long programme.

`/join` runs under the same concurrency ceiling as `/analyze`, because it is the same work. It
decodes every part it is given, and a join that escaped the ceiling would be a way past the operator's
own concurrency setting into the machine's memory.

### Errors

`4xx` / `5xx` with:

```json
{ "error": { "code": "undecodable", "message": "…" } }
```

| Code | Means |
| --- | --- |
| `unfetchable` | the URL did not serve anything |
| `undecodable` | it served something, and it was not audio this decoder knows |
| `truncated` | the audio stopped early enough that measuring it would lie |
| `internal` | anything else |

The adapter plugin maps these onto `PluginError`, and the station records the failure against the
track so an undecodable file is not re-fetched and re-decoded on every pass forever.

## How the four points are found

`cueIn` and `cueOut` are the cheap two: the first and last frame whose RMS crosses a floor around
−60 dBFS. That is the whole algorithm, and it is most of the audible benefit.

`introEnd` and `outroStart` are the real work. The envelope they are measured from is band-limited to
roughly 200 Hz–4 kHz on purpose, and this is the one detail worth not losing:

> **A detector weighted to low frequencies places `outroStart` too early on a quiet ending.**

That is the exact case an ending-aware transition exists to serve, so a full-band envelope fails
hardest where it matters most. The band above keeps the decision on the part of the spectrum where
voices and lead instruments live, which is what a listener is actually tracking when they hear a
record "still going".

From that envelope: a reference level is taken as a high percentile inside the sounding region,
`introEnd` is where the smoothed envelope first sustains a useful fraction of it, and `outroStart` is
the last moment it was still there. A record that ends cold has its last full moment near the end and
so a short outro; one that fades has it early and a long one. No constant to tune per record, and no
classifier.

## How the vocal onset is found

**Band energy alone would measure nothing new**, and that is the whole design. 200 Hz–4 kHz is
already what `introEnd` uses, because it is where voices *and lead instruments* live — so a second
detector over the same band would re-derive `introEnd` under another name. `introEnd` is "the beat
established, OR the vocal in", a guess about two different events, and telling them apart is the
point.

What separates a sung line from a held note is that a voice is **syllabic**: its level rises and
falls a few times a second where a pad or a sustained guitar does not. So `vocal.py` measures the
*envelope's own* modulation in the 2–8 Hz band against the level it is modulating. No model, no
weights, no separation toolkit — `docs/decisions/analysis-licensing.md` is unaffected, and its
one-line description of these fields as "band-limited energy" is what this paragraph replaces.

The figure means something: for an envelope `A(1 + m·sin)` the AC part has RMS `A·m/√2`, so what is
reported is the modulation depth over root two. Two things it got wrong first, both kept as tests:

> **A ratio is scale-invariant, so it needs an ABSOLUTE floor.** A 60 Hz bassline modulated at
> syllable rate leaks through the band-pass at −96.6 dBFS and, divided by its own residual, read
> 0.61 — a confident vocal on every dance record in the library. A floor relative to the track's own
> level cannot catch it, because a track made of leakage sets its reference from the leakage.

> **A sustain requirement must outlast the smoothing that feeds it.** The presence is a moving RMS
> over a one-second window, which smears a 0.4 s shout across about a second — manufacturing exactly
> the run the sustain check was looking for. Requiring a sustain equal to the window is no
> requirement at all, so it is twice it.

> **`to_mono` is an energy envelope, not a downmix, so nothing spectral may be built on it.** It
> folds channels as `sqrt(mean(x²))`, which is non-negative and therefore RECTIFIES — and a
> band-pass over a rectified signal reads harmonics that rectification invented. Measured on a 60 Hz
> bassline in real stereo: **−32.5 dBFS inside 200 Hz–4 kHz, against −96.6 dBFS from the waveform
> itself.** Every stereo record with a bassline read as singing from the first bar. So the vocals
> fold with `to_downmix` (a plain average, which preserves the waveform) and the cue points keep
> `to_mono`, which they are calibrated against and which only ever asks *whether* the record is
> sounding rather than *what* is.

That last one costs a second band-pass per record — about 0.7 s over five minutes, small against the
decode — and the saving is not available: the two measurements are reading different signals on
purpose. Anyone optimising the second pass away should read this paragraph first.

Everything leans **early rather than late**, because an onset reported late puts a talk-up over the
first word and one reported early only costs talk-up time. The curve takes the maximum in each bin,
and the centred smoothing already reads a line entering about half a second before the first word
lands. That bias is left in.

## How loudness is measured

To ITU-R BS.1770-4 / EBU R128: K-weighting, 400 ms blocks at 75 % overlap, an absolute gate at
−70 LUFS and a relative gate 10 LU below the ungated mean. `truePeakDb` is 4× oversampled, because
the reconstructed waveform between two samples routinely exceeds both of them by around a decibel —
which is exactly the margin a boost has to respect, and the reason sample peak alone is not enough.

The decode happens at **48 kHz** because that is the rate BS.1770 publishes its filter coefficients
at. Nothing else here needs it, but re-deriving those coefficients for a lower rate is the step most
likely to be quietly wrong, and decoding twice would cost more than the extra samples do.

**The channels are kept, and that is not a nicety.** BS.1770 SUMS the weighted power of each
channel; a stereo→mono downmix averages them. Measuring the downmix shipped once and was wrong in two
ways at once, both confirmed against ffmpeg: uncorrelated material read 3.0 dB low (−18.8 against a
true −15.8), and anti-phase material cancelled to nothing and produced no reading at all. Real music
sits between the two, so the error was material-dependent and unpredictable, which is worse than a
constant one. The cue points still want a single signal, so the fold happens for them alone and is
energy-preserving (`sqrt(mean(x²))`) rather than an average, so anti-phase content survives it.

Anything wider than stereo is folded to stereo rather than measured with the surround weights the
standard defines. A music catalog is stereo, the fold is what a listener on this mount hears anyway,
and implementing weights against material nobody here can test would be worse than saying so.

Three facts worth keeping, because all of them look like bugs when you meet them:

- **The calibration frequency is 997 Hz, not 1000.** The K-weighting curve's gain at 997 Hz is
  +0.691 dB, which cancels the −0.691 offset in the loudness equation exactly — so at that one
  frequency, LUFS is simply RMS in dBFS. At 1000 Hz the curve is already +0.698 dB, so a test written
  there reads 0.7 LU high and looks like a broken implementation.
- **A true peak above 0 dBTP is real, not a clamping failure.** It means the master overshoots on
  playback, which is the thing worth knowing before adding gain to it.
- **True peak is measured in chunks, and only each chunk's middle counts.** The resampler zero-pads
  what it is handed, so every chunk ends in a step that rings, and the ringing overshoots by up to a
  decibel — a whole decibel of headroom the station would then decline to use. The context either
  side is only worth having because the output is trimmed back to it; without the trim, the overlap
  just moves the artifact.

Both numbers agree with ffmpeg's own independent `ebur128` filter to two decimal places on mono,
correlated stereo, uncorrelated stereo and anti-phase signals. That is the cheapest available
cross-check and it is worth repeating after any change here, because every failure this code has had
so far produced a number that looked entirely plausible:

```bash
ffmpeg -nostdin -hide_banner -i track.mp3 -filter_complex ebur128=peak=true -f null -
```

## Configuration

| Env | Default | What |
| --- | --- | --- |
| `ANALYSIS_WORKERS` | `min(4, cores)` | the MOST that may decode at once |
| `ANALYSIS_PORT` | `9321` | listen port |
| `ANALYSIS_MAX_SECONDS` | `1800` | refuse audio longer than this |
| `ANALYSIS_MAX_BYTES` | `512M` | refuse a download larger than this |
| `ANALYSIS_FETCH_TIMEOUT_S` | `180` | how long to wait on the audio fetch |

`ANALYSIS_WORKERS` is a **ceiling, not an operating value**. How many tracks actually decode at once
is the station's own `analysis.concurrency`, because the walk is the station's and it is the number an
operator can change from a console; this is the most of this machine the walk may ever have.

The split is what lets one knob do the job. The station still cannot compute this — an operator may
point `baseUrl` at a machine with thirty-two cores or at a Raspberry Pi — so the machine keeps a veto,
but a veto expressed as a ceiling costs nothing until it is reached. Expressed as the operating value,
which is what this was, it silently discarded every increase the console made and looked exactly like
a setting that does not work.

The default is `min(4, cores)`, and the bound is memory rather than CPU: a decode holds the whole
record as float32 at 48 kHz, so a five-minute track is ~115 MB resident before `to_mono` copies it,
plus the downloaded file and ffmpeg's own buffer. Set it lower to lend the walk less of a machine that
is also running the station. Requests above it wait here, and they spend their own timeout waiting, so
a ceiling well below `analysis.concurrency` costs measurements rather than merely slowing them.

## Running it

```bash
docker compose up -d analysis
```

Then, without involving the app at all:

```bash
curl -s localhost:9321/health
```

```bash
curl -s -X POST localhost:9321/analyze -H 'content-type: application/json' -d '{"url":"http://localhost:8000/some.mp3"}'
```

```bash
curl -s -X POST localhost:9321/join -H 'content-type: application/json' \
  -d '{"parts":[{"url":"http://localhost:8000/one.wav"},{"url":"http://localhost:8000/two.wav"}],"gapMs":200}' \
  -o joined.flac
```

Check the answers against the file in an audio editor by eye once. There is no test that can hear it,
and that goes double for the gap: 200 ms is a starting point somebody has to listen to.

**The URL has to be reachable from this container**, which is not the same network position as the
API process. The bundled track fetcher is `liquidsoap:3679` inside compose and `127.0.0.1:3679` from
a host-run `pnpm dev`. A URL that works in the app and 404s here is the first thing to check when
every analysis fails at once.
