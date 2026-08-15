# Deferred: the news on air, and the watcher that would put it there

**Written:** 2026-08-15, the day the source half landed.
**State of the tree:** the SOURCE half is BUILT and is described below as fact. Everything under
"What is deferred" is not built, and each piece names the seam it drops into.

---

## What was built, so nothing below has to re-derive it

- **`feed.parse.ts` in the plugin SDK.** `parseFeed(xml)` normalises RSS 2.0, Atom and RSS 1.0/RDF
  into one shape; `fetchFeed(host, url)` is the thin half over `host.fetch`. It is in the SDK rather
  than in the plugin because every plugin that reads a feed writes the same normalisation, exactly
  the argument `plugin.http.ts` makes about the status ladder.
- **A `news` capability** (`capabilities/news.ts`): `listFeeds()` and `fetchItems({ feedId?, limit,
  since? })`, answering `NewsItem`s. Charts' shape rather than enrichment's — a menu, never a merge.
- **`plugins/rss`**, bundled. The operator's own list, one feed per line, with an optional id and
  name in front of the address.
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

### 1. The bulletin: a `news` segment kind

The station can already be told to take one. `clock.bands.ts` parses `:30 news` today, and
`BreakPlanner.refuse` turns it down with "nothing on this station knows how to write a news" —
which is the whole of what is missing.

What it needs, all on seams that exist:

- **A `NewsBreakWriter`**, registered in `director.module.ts` under the kind `news`, with a
  `ModelNewsBreakWriter` in front of it. Registration order is preference order, and the FLOOR
  CANNOT FAIL: a deterministic writer that reads two or three headlines aloud is the thing that
  makes a slow model cost a better bulletin rather than a silent slot.
- **`BreakWriteRequest.context`** is where the stories go. Its doc comment already says a news
  bulletin is what it exists for, and the shape is per-kind, so nothing generic has to agree on it.
- **The caller fetches**, not the writer. `BreakTrack.facts` sets the rule: a writer is a pure
  function of what it was told, so `WriteBreakJob` reads `NewsService` and hands the stories over.
  A writer reaching into a service for itself is the thing that makes bindings disagree about what
  they may know.
- **Freshness is `claimsTime`'s problem, and it is already solved.** A bulletin written fifteen
  minutes before its slot is a statement about the hour, so it uses the same expiry the clock
  phrasings use rather than inventing a second one.

Open, and genuinely open: **how many stories one bulletin reads**, and whether the model gets the
summaries or only the headlines. Both are cheap to change and neither is worth deciding on paper.

### 2. Breaking news, and it is NOT a news feature

The thing worth building is a small host-side **watcher over a polled capability**: a loop that asks
a source what is new since it last looked and posts a `BreakRequest` — kind, urgency, `context`,
`key` + `cooldownMs` — to `DirectorService`, like every other producer.

News is its first subject and not its only one. A chart with a new number one, a scrobble milestone
and a weather warning are the same shape, which is why this is a watcher over a source rather than
a `NewsWatch`.

Three rules, and all three are already paid for:

- **A plugin does not push.** Nothing in the built half gives a plugin a way to reach the director,
  and it must stay that way (`docs/decisions/on-air-ownership.md`: every writer posts a command and
  none of them writes the running order). Polling is host code, so urgency, cooldown and whether the
  station is even on air stay host decisions.
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

### 4. A console page

`GET /news/feeds` and `GET /news` exist and nothing draws them. The charts page is the shape to
copy. Worth having before the bulletin lands rather than after: "what does the station think the
news is" is the first question when a bulletin reads oddly.

---

## Related

- [tool-plugins.md](tool-plugins.md) for the `tool` capability this was expected to arrive behind,
  and why it did not need to.
- [chart-discovery.md](chart-discovery.md) for the capability this one is shaped on, and for the
  same watcher's second subject.
- [dj-voice.md](dj-voice.md) for the writer registry, the floor rule, and the four pieces of
  plumbing a second kind of break inherits for nothing.
- [station-moment.md](station-moment.md) for weather, which is the other half of the same bulletin.
