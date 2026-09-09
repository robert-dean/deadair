# Deferred: charts as a plugin, and picks the library has never held

**Written:** 2026-08-13, from the question "how would an operator fetch the top hits and have the DJ
build a lineup out of them".
**State of the tree:** none of this exists. Everything it stands on does — that is the reason to
write it down now rather than design it later.

---

## Why this is small now and was not before

A `SetGenerator` pick is a NAME (`director/set.generator.ts`): a title and an artist as strings, with
`trackId` present only when the generator already knew it. Until recently a name the catalog did not
hold was dropped, so a source of names from outside the library would have produced a running order
that came up short with nothing in the log connecting it to the source.

That is no longer true. `PickResolver.identify` falls through to `ProviderTrackLookup`, and a strict
hit becomes a real `deadair.tracks` row with a binding, bounded per resolve by `MAX_DISCOVERIES` and
gated by `rotation.discover`. So a chart source has to answer with strings and nothing else: the
ingest, the dislike veto, the repeat window, the artist spacing and the fetch-and-bench are all
already downstream of it, and it inherits every one of them by doing nothing.

**This is the same argument the README's "a pick is judged where it becomes a track" note makes about
the model generator, and it is now paying for a second time.** Anything here that grows its own idea
of what may air is a bug.

## The shape

A `charts` capability in the plugin SDK:

- `listCharts()` returns what this plugin can serve: `{ id, name, country?, genre? }`.
- `fetchChart({ chartId, limit, date? })` returns `{ rank, title, artist, album?, year?, peak?,
  weeksOn? }`.

Both ends are plain JSON, so it classifies into `boundary.json.safe.ts` with the payload types and
needs no exemption. Egress is `host.fetch` like everything else, with `permissions.network` carrying
`ratePerSecond` and a shared `bucket` per service rather than per hostname.

**The chart id is a per-call parameter, not a config field**, for the reason the LLM model is:
`plugin_configs.plugin_id` is a primary key, so a station that wants a national top 40 at drivetime
and a country chart in the evening cannot express that by installing the plugin twice.

`date?` is in the signature because a chart is a weekly document with a history, and "the hits of
this week in 1994" is a show. Whether a given service can answer it is the plugin's business.

## Three consumers, all seams that already exist

| Seam | What it gets | Needs a model |
| --- | --- | --- |
| `ToolRegistry` (`llm/llm.tools.ts`) | `browse_charts`, beside `search_library` and `search_catalog` | yes |
| `SetGeneratorChain` (`director/set.generator.chain.ts`) | `ChartSetGenerator`, between `ModelSetGenerator` and the catalog floor | **no** |
| `enrichment` | peak position, weeks on chart, this week against last | no |

The tool is the interesting one and the generator is the important one.

**The tool** is the second `ToolSource` that [tool-plugins.md](tool-plugins.md) deferred, and it
passes that file's own test for what belongs in a plugin: the thing it talks to is somebody else's
service. It gives a model DJ a brief it cannot get from the library ("the biggest records in the
country this week") and, more than that, gives it true things to say about them. A position is a
fact, and a fact is what a break is short of.

**The generator** is the half that keeps working when the model does not. The station's model is
self-hosted and its slow mode is very slow, so a discovery feature reachable only through the tool
loop is a discovery feature that disappears exactly when the station is under strain. A chart is an
ordered list of names; turning it into picks needs no intelligence at all.

**The enrichment half** is nearly free once the fetch exists: chart history lands in `facts[]`, which
is the field the writers already read.

## Things to get right when it lands

- **`rotation.discover` off makes the generator inert**, because a chart pick is almost never in the
  library. That is a legitimate operator choice, but silence would read as a broken plugin. Decline
  loudly and once, the way `llm.breakWriter` being off is just the first binding declining early.
- ~~**`MAX_DISCOVERIES` is counted as attempts and is a constant.**~~ **Done, 2026-08-15**, forced by
  the model generator hitting it first: a briefed refill needs a lookup for every pick, so a flat
  eight against a batch of twenty-four dropped two thirds of them without asking a provider. It is
  now `discoveryCap(picks)` — one per pick, floored at `MIN_DISCOVERIES` and ceilinged at
  `MAX_DISCOVERIES` — so this prerequisite is already met. The cap it protects is still real: every
  miss searches every provider.
- **Registration order is preference order, and the catalog stays last.** The chain tops up rather
  than falling through, so the chart generator names what it can and the floor finishes the rest —
  which is also the answer to "what happens when the chart service is down".
- **How much of a batch a chart may claim is a setting, not a constant.** An hour that is entirely
  this week's top 40 is a format some operators want and most do not. One number (`rotation.chartMix`
  or similar, 0 meaning off) is the whole of it, and 0 by default keeps the plugin from changing what
  a station plays merely by being installed — the same default posture as `llm.setGenerator`.
- **A chart entry is not a record the station owns.** Everything ingested through this path arrives
  unmeasured and airs untrimmed until the analysis pass reaches it. That is already true of any
  discovered copy and is not this file's problem to solve, but an operator who turns a chart hour on
  will hear it, so it belongs in the console copy.
- **The brief and the chart can disagree.** `station_lineup.brief` is somebody deciding tonight; a
  chart is a fixed document. The generator should read the brief only far enough to pick a chart
  (a country, a genre) and never to filter one, because approximating an instruction is the thing
  the deterministic layer is not allowed to do.

## Where the data comes from

Billboard is the name an operator will ask for and the one service here with **no public API**. What
exists is community scraping of the published pages and a daily-refreshed JSON mirror of them; both
are a bet on somebody else's markup and somebody else's terms, and the charts are their publisher's
property. So Billboard is a chart NAME to reach eventually, not the first plugin.

Ranked for a first build, all checked 2026-08-13:

| Source | Auth | Shape | Notes |
| --- | --- | --- | --- |
| Apple marketing RSS | none | `rss.marketingtools.apple.com/api/v2/{cc}/music/most-played/{limit}/songs.json` | Official, per-country, daily. Entries carry `name`, `artistName`, `releaseDate`, `genres[]`, artwork and a store link — nearly field-for-field onto the shape above, minus rank history. **The default.** Note the older `rss.applemarketingtools.com` host 301s here |
| Deezer `/chart` | none | public catalog API | Auth-free, roughly 50 requests per 5 seconds (community-measured, not published). Gives ids worth searching against |
| ListenBrainz fresh releases | none | `/1/user/{user}/fresh_releases` and a global feed | NEW rather than POPULAR, and it answers in MBIDs, which the existing musicbrainz plugin already speaks. A different brief, not a worse chart |
| Last.fm `chart.getTopTracks` / `geo.getTopTracks` | API key, no user auth | global and per-country | Real listener counts. Their terms are non-commercial-only, which is fine for one operator running one install and belongs in the plugin's config copy rather than in a comment nobody reads |

Two of these are worth having at once eventually, because a chart plugin per service is the point of
the capability: `listCharts()` is how the console offers them and how the operator picks.

## Phases

Each leaves the tree working and is one commit.

1. **The capability.** `capabilities/charts.ts`, the manifest entry, the boundary classification. No
   consumer, no behaviour change.
2. **The first plugin**, over the Apple feed, implementing `listCharts` and `fetchChart` only, plus a
   console page that lists a chart. Proves egress, the rate bucket and the config field. Nothing is
   scheduled from it.
3. **The tool.** `ChartsTool` registered as a `ToolSource` in `LlmModule`. The DJ can read a chart and
   talk about it. Still nothing schedules from it, which makes this the cheapest place to find out
   whether the descriptions steer the model sensibly against the two search tools.
4. **The generator.** `ChartSetGenerator` in the chain behind `rotation.chartMix`, with the
   `MAX_DISCOVERIES` fix. **This is the phase that changes what airs**, and it is last on purpose.
5. **The enrichment half.** Chart history as `facts[]`.

## Related

- [tool-plugins.md](tool-plugins.md) for the `tool` capability this is the first real customer of,
  and for the rule that separates a plugin tool from a host-side source.
- [station-intelligence.md](station-intelligence.md) §1 for the chain this drops a binding into, and
  §2 for the budget that is deliberately not built.
- [director-and-lineups.md](director-and-lineups.md) for "plugins that programme the station", which
  is the general case of this file.
- `packages/plugin-sdk/CLAUDE.md` § "Trust and egress" for why a plugin fetching somebody else's
  chart in the host realm is unremarkable.
