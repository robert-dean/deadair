# The analysis sidecar

Measures one track's audio and answers with offsets: where the record actually starts, where it is
underway, where the ending begins, where it stops. The station reads those to trim dead air off the
head and tail of every record, to know how long it may talk over an intro, and later to size a blend
between two records.

**This directory is one implementation of the contract below, not the contract itself.** Anything
that answers these two endpoints is a valid analyzer, and swapping to it is a `baseUrl` change in the
plugin's config. That is the whole reason the boundary is HTTP.

## Why it is a separate program

Two reasons, and the second is the one that gets forgotten.

**Decoding does not happen in Node.** Every field here comes from PCM samples rather than from a
container, and the API server is the one place the station's architecture says audio does not go. A
CPU-bound decode loop inside the request path would be a decision nobody made.

**The licence position is materially different.** The toolkits that compute beat grids and separate
vocals — which the deferred beat layer needs — are mostly copyleft, several of them AGPL. A separate
program communicating over HTTP is not the same as linking one of those into the API process. If this
container is ever "simplified" back into app code, that is the thing being given up, and it will not
be visible in the diff.

Today's implementation needs neither: cue points come from a band-limited RMS envelope and loudness
from a published filter, so the dependencies are a decoder and two permissively licensed array
libraries. The copyleft question arrives with the beat layer, which is precisely when this boundary
starts paying for itself.

## The contract

### `GET /health`

Cheap. Does no work, decodes nothing.

```json
{ "status": "ok", "schemaVersion": 1, "analyzer": "deadair-analysis/0.1.0" }
```

Two callers, two purposes. The plugin's connection test uses it so the console can say "not
reachable" before any track is queued. And it is where an operator sees a **schema mismatch**: an
analyzer answering a version the host does not know is a configuration error worth reporting, not a
reason to write rows nothing can read.

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

    "integratedLufs": -8.4,   // gated programme loudness, BS.1770
    "truePeakDb": 1.2,        // oversampled; legitimately above 0
    "samplePeakDb": -0.1
  }
}
```

Every offset in `data` is absolute, into the file, in integer milliseconds — `cueOut` included.
Storing it relative to `cueIn` is the obvious-looking choice and is wrong: everything downstream seeks
in file time, so a relative figure has to be re-based at every read and eventually one read is not.

The three loudness fields are **optional and omitted rather than floored**. A silent or near-silent
track has no loudness, and the alternative to leaving it out is a value like −80 that a caller would
then "correct" by fifty decibels. Absent means no opinion, which every consumer already handles.

`data` is stored by the host as an opaque blob under `schemaVersion`. That is what lets a later
version add a tempo, a downbeat grid or a vocal curve without touching the plugin, the host or the
database.

Synchronous, deliberately. The caller is a background walk with its own time budget and its own
concurrency setting, so nothing is waiting on the response and a job-id-plus-polling protocol would
buy state in this service for no gain. Expect a request to take on the order of seconds per track.

#### `complete` is load-bearing and only this service can answer it

The host hands over a URL and never sees the bytes, so it cannot tell a whole download from a
truncated one. A capped or interrupted fetch produces perfectly confident measurements of a file that
was never the track, and the specific lie it tells is that a record which fades ended cold — which is
exactly the case the measurement exists to serve.

So this service reports it, and the host filters on it. An implementation that always answers `true`
has silently disabled the check. A genuinely short track is `true`; a download that stopped early is
`false`, told apart using `durationMs` where the caller supplied one.

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
| `ANALYSIS_WORKERS` | `1` | how many tracks decode at once |
| `ANALYSIS_PORT` | `9321` | listen port |
| `ANALYSIS_MAX_SECONDS` | `1800` | refuse audio longer than this |

`ANALYSIS_WORKERS` and the station's own `analysis.concurrency` setting are two knobs that have to be
tuned together and **neither can compute the other**. This service owns the CPU, so it sizes the pool;
the station owns the walk, so it decides how many requests are in flight. Deriving one from the other
would need the app to know this container's hardware, which it cannot — an operator may point
`baseUrl` at a machine with a GPU and thirty-two cores. In-flight above the pool size only queues
here; below it leaves cores idle.

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

Check the answers against the file in an audio editor by eye once. There is no test that can hear it.

**The URL has to be reachable from this container**, which is not the same network position as the
API process. The bundled track fetcher is `liquidsoap:3679` inside compose and `127.0.0.1:3679` from
a host-run `pnpm dev`. A URL that works in the app and 404s here is the first thing to check when
every analysis fails at once.
