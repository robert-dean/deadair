# Deferred: the news on air, and the watcher that would put it there

**Written:** 2026-08-15, the day the source half landed.
**Revised:** 2026-08-15, when the bulletin landed too. **§1 is now BUILT**; what shipped is
described in its place, and the sections below it are the ones still open.
**Revised again:** 2026-08-20, when categories landed. §1 grew a subject.
**Revised again:** 2026-09-02. §4's console page is BUILT. Categories grew an off-air switch, which
is what keeps a publisher's deals desk out of a bulletin; see `docs/internals/breaks.md`.
**State of the tree:** the source half and the bulletin are built and are described as fact.
Everything under "What is deferred" is not built, and each piece names the seam it drops into.

---

## What was built, so nothing below has to re-derive it

- **`feed.parse.ts` in the plugin SDK.** `parseFeed(xml)` normalises RSS 2.0, Atom and RSS 1.0/RDF
  into one shape; `fetchFeed(host, url)` is the thin half over `host.fetch`. It is in the SDK rather
  than in the plugin because every plugin that reads a feed writes the same normalisation, exactly
  the argument `plugin.http.ts` makes about the status ladder.
- **A `news` capability** (`capabilities/news.ts`): `listFeeds()` and `fetchItems({ feedId?, limit,
  since? })`, answering `NewsItem`s. Charts' shape rather than enrichment's — a menu, never a merge.
- **`plugins/rss`**, bundled. The operator's own list, as a `list` config field with a name, an
  address and a category per row (it was one feed per line when this was written).
- **A `fromConfig` allowlist entry resolves a LIST of hostnames** (`plugin.host.factory.ts`), which
  is what makes a plugin pointed at operator-supplied upstreams expressible at all.
- **`modules/news`**: `NewsService`, `GET /news/feeds` and `GET /news` on `platform.view`.
- **`read_news`**, a `ToolSource` in `modules/llm/news.tool.ts`, so a model DJ can say something true
  about the world in an ordinary talk break.

**The de-duplication contract is the piece to hold onto.** A `NewsItem.id` is stable for the same
entry across calls (`guid → id → link → hash`, qualified by feed), `publishedAt` is ISO-8601, and
`NewsQuery.since` asks what is new. The RSS plugin's cache is a floor on how often a publisher is
asked and never a filter on what comes back, so a caller polling faster sees repeats — which its ids
handle — rather than gaps, which they do not. Everything deferred below is buildable in one pass
BECAUSE of that; a source that could not answer "what is new since I last looked" without holding
state per caller is the version of this that would have to be redesigned first.

---

## What is deferred

### 1. The bulletin — BUILT 2026-08-15

A `news` segment kind, with two writers ranked the way every other kind is: `ModelNewsBreakWriter`
in front, `NewsBreakWriter` as the floor. A `news` band on the format clock now produces one, and
the planner's "nothing on this station knows how to write a news" refusal is gone.

Six things are load-bearing, and four of them were not obvious before it was built:

- **The floor is not merely a safety net here, it is arguably the better product.** It reads
  published headlines AS PUBLISHED, which cannot be wrong about the news; every other way of
  producing a bulletin — summarising, reordering by importance, joining two stories — is a way of
  being wrong in a voice that sounds certain. The model earns its place by making three headlines
  sound like a bulletin rather than a list, and is checked harder for it.
- **Both writers DECLINE when there is nothing to report.** An empty feed, a publisher that is down,
  a plugin uninstalled between planting and writing, and nothing newer than the freshness window all
  arrive the same way. A bulletin that announces itself and then says nothing is worse than a slot
  the station passes over, which is something it is already built to absorb — and asking a model to
  fill an empty bulletin is asking for a fabricated one. The floor logs that decline itself, because
  it is the one an operator has to be able to act on.
- **`BulletinSource` is the substrate seam**, exactly as `EnrichmentReadService.factsForTracks` is
  for a talk break: the CALLER fetches, once, and both writers see the same stories. It answers
  `undefined` for every kind that does not report, which is what keeps the branch about news inside
  a file about news rather than in the job that serves every kind.
- **Freshness is judged against when the break AIRS**, not when it is written. A bulletin is written
  up to `WRITE_AHEAD` items early, so measuring the window from `Date.now()` would read stories that
  are already over the operator's limit by the time anybody hears them.
- **A headline is made speakable once**, at the source: the publisher's own furniture comes off the
  end (" — BBC News" is a real shape and is not a sentence anybody says), and a full stop goes on so
  three headlines do not run into one sentence.
- **The floor withholds `previous`**, for `WelcomeWriter`'s reason: `usable` insists a phrasing say
  something about the record just finished, and a bulletin that back-announces on its way into the
  headlines is a presenter who has not decided what this break is.

The settings are `rotation.newsTemplates` (with `{{news.headlines}}`, the first new row in the
template vocabulary since it was written), `rotation.newsStoriesMin`/`Max`, `rotation.newsMaxAgeHours` and
`rotation.newsFeeds` (a LIST the station orders, which replaced the single `rotation.newsFeed` id
typed by hand). The format clock that schedules it was a setting too, briefly; it is now
`deadair.clock_bands` and is edited on the schedule page.

**A bulletin can be about ONE CATEGORY, as of 2026-08-20.** `deadair.topics` is the operator's own
vocabulary keyed by `segments.kind` — a chassis rather than a news feature, because
[station-moment.md](station-moment.md)'s weather wants the same shape with a location in it — and a
band on the format clock points at one. `news.classify.ts` ranks three signals (the feed, the
publisher's own labels, a word in the headline), a category that matches nothing DECLINES the slot
rather than reading general news under its name, and an unbriefed bulletin spreads across whatever
the categories say the page holds. `{{news.topic}}`, the model's opening line and the break's own
label all say which one it is.

What is still open here, and was deliberately not decided on paper: whether a bulletin should
attribute its sources out loud. Nothing offers the publisher's name to a writer today (`BreakStory`
carries it, and neither the prompt nor a phrasing uses it), because attribution is a station's own
decision and a model shown a publisher's name will credit it in a sentence nobody asked for.

### 2. Breaking news, and it is NOT a news feature

The thing worth building is a small host-side **watcher over a polled capability**: a loop that asks
a source what is new since it last looked and posts a `BreakRequest` — kind, urgency, `context`,
`key` + `cooldownMs` — to `DirectorService`, like every other producer.

News is its first subject and not its only one. A chart with a new number one, a scrobble milestone
and a weather warning are the same shape, which is why this is a watcher over a source rather than
a `NewsWatch`.

Three rules, and all three are already paid for:

- **A plugin does not push.** Nothing in the built half gives a plugin a way to reach the director,
  and it must stay that way (`docs/internals/director.md` § "Who owns the running order": every
  writer posts a command and none of them writes the running order). Polling is host code, so
  urgency, cooldown and whether the station is even on air stay host decisions.
- **What is new is answerable from the capability alone.** The id/`publishedAt`/`since` contract
  above, plus a cache that never filters. A watcher that had to hold per-plugin state to tell a
  repeat from an arrival is the hard version of this.
- **No urgency signal was invented.** `categories` and the story's own words are what a publisher
  supplies; whether something is worth interrupting a record for is the watcher's judgement over
  operator settings, not a boolean a feed hands us. A field for it would be the plugin API claiming
  to know something it cannot.

Two things to get right when it lands. `BreakUrgency` already splits on the thing that matters: an
`interrupt` or `next` request is RENDERED before it is injected, which is exactly right here,
because a bulletin that arrives at its slot unready is a moment that does not come round again. And
the watcher needs a `pollHintMs` floor and a per-key cooldown, or a publisher that re-dates its
front page will have the station announcing the same story every four minutes.

### 3. Host-side conditional GET

`ETag` / `Last-Modified`, so a poll that finds nothing new costs a 304 rather than a document. The
right home once there is a second feed-reading plugin, or once the watcher above is polling on a
schedule — at which point it is the same code either way. With one consumer it would be a host
surface built for an audience of one; the RSS plugin's in-memory window covers today's actual
failure mode, which is a model calling the tool twice inside one break.

### 4. A console page — BUILT

`apps/web/src/components/news/news.page.tsx` draws `GET /news/feeds` and `GET /news`: the stories a
bulletin would be written from, with a feed filter asked of the server and a category filter applied
in the browser by joining stories to feeds on `feedId`. It deliberately does not show what was READ
on air — the twelve-hour log is in memory and on no contract, and `script_history` is the record.
`apps/api/scripts/news.smoke.ts` prints the same thing from a shell.

---

## Related

- [tool-plugins.md](tool-plugins.md) for the `tool` capability this was expected to arrive behind,
  and why it did not need to.
- [chart-discovery.md](chart-discovery.md) for the capability this one is shaped on, and for the
  same watcher's second subject.
- [dj-voice.md](dj-voice.md) for the writer registry, the floor rule, and the four pieces of
  plumbing a second kind of break inherits for nothing.
- [station-moment.md](station-moment.md) for weather, which is the other half of the same bulletin.
