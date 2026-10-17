# Internals: metrics

How the station keeps its own numbers over time: how many were listening, how long its work took,
what it asked the model for. The module is `apps/api/src/modules/metrics`; the table is
`deadair.metric_samples` (migration 0105). The generic half is
[`@maroonedsoftware/telemetry`](https://github.com/MaroonedSoftware/ServerKit/tree/main/packages/telemetry),
and this file covers only what the station adds on top of it.

Every paragraph here records a decision and the obvious alternative it was chosen over. Read the
ones covering whatever you are about to change. The always-loaded index is
[`CLAUDE.md`](../../CLAUDE.md).

## What it is not

**Not the activity feed, and not Traces.** `station_events` is a sentence per moment, written on
edges. Traces is a week of decisions in JSONL files, read one decision at a time. This is numbers:
one row per series per minute, folded into hours, kept for a year, read as a line on a chart. A fact
that is a moment belongs in the feed; a number that changes all the time belongs here.

## One recorder, five numbers, a row per series per minute

**Every producer observes into one in-process `MetricsRecorder`, and nothing is written per
observation.** The recorder folds what it is told into one-minute buckets of five numbers (`count`,
`sum`, `min`, `max`, `last`), and `MetricsFlusher` writes them once a minute. So the table grows with
how many distinct series exist, not with how busy the station is, and a minute in which a job ran a
thousand times is still one row for that job.

**Five numbers cover all three kinds of metric, so there is one row shape.** A gauge reads `last`, a
counter `sum`, a duration `sum / count` and `max`. **There are no percentiles**, deliberately: they
need a histogram or a sketch per bucket, and a duration's mean beside its worst is enough to see that
something got slow.

**A producer never imports the metrics module, only the recorder.** It registers a gauge on
`MetricsRecorder` in its own `ready()` (as `PlayoutModule` does for the audience), or calls `observe`
where the work happens. Names live in `metric.names.ts`, so the producer and the route that reads a
metric back cannot drift apart over a typo.

## Where the numbers come from

**Work durations, model tokens and failures are read off the trace spans, so no call site measures
anything twice.** `recordSpan` (`shared/trace.spans.ts`) is where the job runner, the plugin invoker
and the model loop already time their work, and `onSpan` lets the metrics module hear every span as it
is filed. `span.metrics.ts` turns `job.run` into `work.job.ms` by queue, `plugin.invoke` into
`work.plugin.ms` by plugin and method, and `llm.generate` into `model.call.ms` and the three
`model.tokens.*` counters by decision kind and model. The decision kind is a job's queue name; **a request counts as
`request`**, because its trace kind is its method and path and a path carries ids, which would make
every id a new series per minute. Any failed span of those three adds one to
`work.failed`. A model call that never answered adds its time and its failure and no tokens, which is
the case the span exists to keep.

**A listener hears spans the file never records.** The file keeps only work inside a decision; a
timer's plugin call has no decision to belong to and is still worth counting, so a listener is told
about every span and work outside one is labelled `kind: none`. A listener runs synchronously inside
`recordSpan`, so it observes into memory and nothing more, and one that throws is swallowed.

**What Check-up shows as now is kept as gauges, read the way Check-up reads it**
(`station/station.gauges.ts`): the library's total, cached and measured counts every five minutes
from one shared query, the model's waiting depth every minute, and the station's media on disk every
fifteen, because that one walks three directories. Registered by `StationModule`, which already reads
all of them, so none of the owning modules has to know a trend exists.

**There is no money.** Tokens are counted and cost is not, because nothing in the station knows a
price. Turning one into the other needs per-model prices, which is its own idea.

## The flusher

**A module-owned loop, not a cron job**, because what it drains is in this process's memory: a
pg-boss job could run in any worker and would find nothing there.

**A minute that cannot be written is dropped, not kept.** Re-queuing would turn an hour-long database
outage into an hour of buffered rows in memory, all written at once when it came back, and a gap is
the honest picture of that hour anyway. The outage is logged when it starts and when it ends, not
every minute.

**The module registers right after `DataModule`, so it tears down late.** Shutdown writes the last
partial minute, which has to come after every producer has stopped and before the pools close.
`tests/modules/modules.test.ts` pins both sides.

**A gauge answers `undefined` for "not known yet"**, and nothing is recorded for that minute. The
audience gauge reads `AudienceWatch.measuredListenerCount()` rather than `listenerCount()` for exactly
this reason: the latter folds "before the first reading" into zero, which would draw every deploy as
an empty room.

## Two resolutions, two windows

**Minute rows for a week, hour rows for thirteen months** (`metrics.minuteRetentionDays`,
`metrics.hourRetentionDays`, both in the housekeeping group, both `0` for keep everything on
`resolveRetentionDays`'s rule). Minutes answer "what happened this afternoon" and nobody zooms to the
minute a month later. Hours answer "is the audience growing", which needs months, and thirteen of them
lets a month be read against the same month last year.

**`metrics.rollup` folds the last THREE complete hours every hour, not just the one that closed.** The
fold replaces the hour row rather than adding to it, so going back is free of double counting and
costs a few statements. It buys two things: a minute the flusher wrote after the hour turned is picked
up, and an hour the job missed during a deploy is folded instead of being lost when its minutes are
swept a week later.

**`metrics.prune` sweeps nightly**, each resolution to its own window, so a station keeping every hour
forever still sweeps its minutes, which is the case that matters for disk.

## Reading them back: the Trends tab

**`GET /metrics/series` picks the resolution, not the caller**: minutes for two days or less, hours
beyond, because the minute rows are gone after a week anyway and a month of minutes is forty thousand
points a chart draws as a smear. It refuses a read it could not answer sensibly (no names, more than
twenty, an empty or backwards range, or one longer than the hour rows are kept) rather than answering
it slowly.

**The console folds whatever comes back into at most 120 points per chart**
(`apps/web/src/components/trends/trends.data.ts`), in whole multiples of the stored resolution so a
stored point never straddles two bins, and keeps every bin of the window, empty ones included. Charts
draw with `connectNulls={false}`, so a stretch nothing was measured is a gap: the station was down,
not quiet.

**A lone reading gets a dot.** With gaps kept and dots off, a reading with nothing either side of it
is a line from a point to itself and draws nothing: the first minute on a new install, a gauge read
every fifteen minutes on a range drawn by the minute, a service that sent once. `isolatedDot` draws
exactly those and nothing else, through Mantine's `lineProps`/`areaProps`, which it spreads after its
own `dot`.

**Each section reads its own query**, on Check-up's rule that one dead reader costs one box and not the
page. The work section is two ranked tables rather than a chart, because "which queue took the time"
is a ranking and a line per queue would need a colour per queue.

**Two series colours per theme, picked by measurement.** `--da-series-a` and `--da-series-b` in
`tokens.css` are the accent's hue and grape (the station's own, which already marks the model's work),
at steps run through the categorical palette checks against each theme's panel. The dark themes' `.4`
accents failed the lightness band, which is why these are tokens rather than `phosphor.4`.
`tests/themes.test.ts` holds each to 3:1 against its panel. Status colours are never series colours.

**recharts is in the Trends route's own chunk**, through the router's automatic code splitting, so no
other page pays for it.

## Sending them on: OTLP metrics and traces

**The same minute goes to a collector, not a second measurement.** When `metrics.otlpEndpoint` is set
(Settings, Telemetry), `MetricsFlusher` hands each drained minute to `OtlpExport` after writing it to
the table, and the export sends it through `@maroonedsoftware/telemetry/otlp`'s bridge to an
`OTLPMetricExporter` (OTLP over HTTP with JSON, at `<endpoint>/v1/metrics`). No `MeterProvider` sits
in between: the buckets are already aggregates. Durations go as histograms (count, sum, min, max),
tokens and failures as monotonic counters, the rest as gauges, all with **delta** temporality, so a
collector feeding Prometheus needs its `deltatocumulative` processor. The resource is
`service.name=deadair`, `service.instance.id=<station key>`.

**Off until an endpoint is set, read on every flush.** Naming, changing or clearing the endpoint takes
effect within a minute with no restart; the exporter is rebuilt only when the endpoint or its headers
change.

**The headers are a secret tied to the endpoint** (`sentTo`), written as `OTEL_EXPORTER_OTLP_HEADERS`
is. `OtlpExport` is a singleton and `EncryptionProvider` is scoped, which InjectKit refuses to wire
directly (it failed the boot the first time), so the headers are decrypted in a scope of their own,
and only when the stored value changes.

**A collector that is down never costs the table its minute**, and the export never throws: it is
logged when it goes and when it comes back, by its address and never its headers, and the minutes in
between are dropped rather than queued, on the flusher's own rule.

**Traces are the trace file's spans, sent on.** The same `onSpan` listener that counts work hands each
span to `OtlpExport.queueSpan`, which holds up to 5,000 between flushes (past that a span is counted and
dropped) and sends them with the minute to `<endpoint>/v1/traces` (`metrics.otlpExportTraces`, on by
default). `span.traces.ts` maps them: **each decision is a trace keyed by its own id; a job's `job.run`
is the root**, given an id derived from the decision so the calls it made, which are filed BEFORE it,
can already name it as their parent. A request has no root span, so its calls are the top of its trace.
A decision a previous one queued carries a **link** to that one's root rather than a parent, because it
is separate work in a separate trace, the edge Traces draws as an indented row. Work outside any
decision is not sent, exactly as the file does not keep it.

## Taking other services' metrics: OTLP in

**`POST /otlp/v1/metrics` takes an OTLP/HTTP export sent as JSON, and answers 404 until
`metrics.otlpReceive` is on.** Senders point at `<station>/api/otlp` with
`OTEL_EXPORTER_OTLP_METRICS_PROTOCOL=http/json` and an operator's API key as a Bearer header; the
route is `platform.manage` because it writes rows into the station's own table. It is
`operation(internal)`, so no SDK method: no console calls it. Protobuf is not read; a protobuf sender
gets 415 from the contract's content type.

**`OtlpIngest` is a singleton holding one `OtlpMetricsReceiver`** (from the telemetry package), because
the receiver remembers each cumulative series' last value, which is how a running total becomes an
increase, and the series it has admitted, which is how the cap (`metrics.otlpMaxSeriesPerName`,
default 50; and 500 names overall) holds across requests. A receiver per request would turn every
cumulative sum into nothing. Rows are written with `source: 'otlp'`, folded into minutes like a flush,
so a sender exporting every ten seconds costs one row per series per minute.

**The answer is OTLP's own**: `{}` when everything was taken, `partialSuccess` with a count when
points were dropped by the cap or were a kind the receiver does not read (exponential histograms,
summaries). OTLP senders log a partial success rather than retrying, which is what a point dropped
on purpose should cause.

**A chunked request is a body.** The OTel JS exporters stream their body with
`Transfer-Encoding: chunked` and no `Content-Length`, and ServerKit's body gate used to decide "is
there a body" from the length alone, answering 411 to every one of them. servercore 0.4.1 and koa
4.1.3 count a chunked body as a body; do not pin either below that, or the JS SDK stops being able to
send here while every sender that declares a length keeps working, which is a failure nobody notices.

**The Trends tab's Received section** lists `source: 'otlp'` names from `GET /metrics/names` and draws
one at a time, read as an average, total or largest by the operator's choice, since the station cannot
know whether a received metric is a gauge, a counter or a duration.
