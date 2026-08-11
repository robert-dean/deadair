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

Today's implementation needs neither: cue points come from an RMS envelope over decoded samples, so
the only dependencies are a decoder and an array library. The copyleft question arrives with the beat
layer, which is precisely when this boundary starts paying for itself.

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
    "cueOut": 213600
  }
}
```

Every offset in `data` is absolute, into the file, in integer milliseconds — `cueOut` included.
Storing it relative to `cueIn` is the obvious-looking choice and is wrong: everything downstream seeks
in file time, so a relative figure has to be re-based at every read and eventually one read is not.

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
