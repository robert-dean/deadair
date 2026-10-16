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
`model.tokens.*` counters by decision kind and model. Any failed span of those three adds one to
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
