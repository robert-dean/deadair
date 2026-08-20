# Deferred: the moment the station is playing into

**Written:** 2026-08-09, while scoping the `llm` seam.
**State of the tree:** nothing here exists. There is no `moment` module, no `deadair.moods` table and
no occasion calendar. `ResolvedRules` in
[rotation.rules.ts](../../apps/api/src/modules/director/rotation.rules.ts) is the whole of what
currently steers a lineup, and it knows nothing about the clock.

---

## What this is

A station sounds different at seven in the morning than at midnight, different on Christmas Eve than
on an ordinary Tuesday, and different when it is raining. Two separate things follow from the same
fact: **what gets played** changes, and **how the DJ talks about it** changes.

That is the whole reason this is its own thing rather than a field on either one. Two consumers means
a resolver both read. Put the clock inside the writer and the selector cannot see it; put it inside
the selector and the writer has to ask the selector what time it is.

```
StationMoment  ->  SetGenerator / rotation rules   (what plays)
               ->  the segment writers             (what is said, and how)
```

## The four pieces

### Moods are operator data, not an enum

A `deadair.moods` table: the word itself, a "sounds like" description, and an order. The description
is doing real work in both directions. A writer puts it in a prompt, and a selector matches it against
the tags a track carries.

**It must be data from the first commit.** An enum shipped first means every consumer hardcodes it,
and the admin page that lets an operator write their own vocabulary then arrives as a migration
across all of them. The whole appeal of the feature is that the words are the operator's, so the
words cannot be ours.

This does not fit `SETTING_DESCRIPTORS`. A `ConfigField` describes one row of a form, and this is a
list of rows an operator adds to and reorders, so it wants its own table, its own contract and its
own console page beside the settings page.

### The day leans into a mood

A schedule of wall-clock bands, each naming the mood that part of the day leans toward. Half-open
hour bands, resolved in order, with the last one wrapping past midnight as the fallback so every
instant lands somewhere.

The bands are rows rather than constants for the same reason the moods are: choosing them is the
point of the page. A station whose overnight hours start at ten and one whose overnight starts at one
are different stations, and neither should need a deploy.

### Occasions are operator data too

Month/day rules, first match wins, each naming an occasion (a string the writers can say out loud)
and the mood it leans into. Seed the table with the obvious eight so a fresh install already knows
about New Year and Halloween, and let an operator add their own: the local festival is exactly the
case, and it is not one anybody else can seed.

An occasion overrides the daypart's lean for that day rather than replacing the schedule, so a
Christmas morning is still a morning.

### Weather is a plugin

Not a module, and not an HTTP client in the API. It is a third-party integration with per-service
quirks (geocoding, condition codes, cache windows), which is precisely what the plugin boundary is
for, and `host.fetch` gives it the allowlist and the rate limit for free.

Prefer a keyless source so a fresh install has weather without an operator signing up for anything.
Open-Meteo qualifies and needs no key.

**Its locations are TOPICS, and that half already exists.** `deadair.topics` is the operator's own
vocabulary keyed by `segments.kind`, built for news categories on 2026-08-20 and deliberately built as
a chassis: a weather kind registers a `TopicKind` with its own `ConfigField`s (a place, a unit), the
console page draws it with no new component, and a band on the format clock can already say
`weather` / `Atlanta`. What a location MEANS is the weather kind's own business, exactly as what a
category means is `news.classify.ts`'s.

**Ship it as the `tool` capability rather than a `weather` one.** See
[tool-plugins.md](tool-plugins.md): weather is something the DJ asks about in the middle of writing,
which is a tool call, and a plugin can declare more than one capability if the resolver later wants a
structured reading as well.

## The resolver

```ts
interface StationMoment {
    at: string;          // ISO-8601, station-local
    daypart: string;     // the band the clock fell in
    mood: string;        // what that band, or the occasion, leans into
    occasion?: string;   // absent on ordinary days
    weather?: WeatherReading;
}
```

A small `src/modules/moment/`, registered after `SettingsModule` (it reads config) and before
`RenderModule` and `DirectorModule`, which are the two that consume it. Follow the comment convention
in `modules.ts`: the placement is the documentation.

Station-local time, not UTC and not the server's. A station is a place, and its listeners are in it.

## What is blocked, and what is not

**Mood-flavoured talk is blocked on nothing.** The writers take a moment and use it. That is the half
worth building first, and it is worth building even if the other half never lands.

**Mood-biased selection is blocked on data nobody has yet.** Biasing what gets played means knowing a
track's mood, and:

- `EnrichedTrack.moods` already exists in the plugin SDK
  ([enrichment.ts:110](../../packages/plugin-sdk/src/capabilities/enrichment.ts:110)) and **nothing
  populates it.** The MusicBrainz plugin declines it explicitly, and correctly: that service does not
  carry it.
- So it needs an enrichment source that does (Last.fm's tags are the obvious one), a mapping from
  whatever vocabulary that source uses onto the operator's own words, and an index that makes
  "tracks that fit this mood" a query rather than a scan.
- Until then a mood-biased rotation rule would silently match nothing, which is the worst failure
  shape available: a knob that appears to work.

Build the vocabulary, the schedule and the talk. Leave the selection rule for the run that fills the
column it would read.

## Related

- [tool-plugins.md](tool-plugins.md) for the capability weather should arrive as.
- [dj-voice.md](dj-voice.md) for the writers that consume a moment, and the kind-keyed seam they hang
  off.
- [station-intelligence.md](station-intelligence.md) for the layer above the rules, which is where a
  model choosing music on the `SetGenerator` seam belongs.
