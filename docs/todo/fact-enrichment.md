# Fact Enrichment

Status: **built**, except for the parts listed at the bottom.
Intended reader: Claude Code, with access to the deadair repo

## What this file is now

The original brief here was a design for something that did not exist. It exists, so what is left is
the record of what was decided and the short list of what was deliberately not done. Read the code
first: `apps/api/src/modules/enrichment/fact.*.ts`, `plugins/wikipedia/`, and migration
`0015_facts.sql`, whose comments carry the reasoning.

## The goal, which has not changed

Give the DJ real, verifiable trivia to talk about. The bar is a fact like "Hammer Smashed Face by
Cannibal Corpse appeared in Ace Ventura: Pet Detective": specific, checkable, and interesting to a
listener who already likes the song.

## The shape it took

**A plugin fetches, the host thinks.** Almost none of this content is in structured metadata; it is
in prose. `plugins/wikipedia` resolves a record to a Wikidata item by its MusicBrainz id and hands
the article over as a `SourceDocument`, verbatim. It composes no sentence of its own. Turning prose
into something sayable is host-side, because only the host can check a claim against the text it
came from — and because there is no `llm` capability on `PluginHost`, deliberately.

**Two extractors, and the floor is the deterministic one.** An article's opening sentence is already
a sourced, speakable claim, and taking it verbatim needs no model and no verification pass, because
the claim and the quote are the same span (`fact.lead.ts`). The model pass (`fact.model.ts`) adds
what a lead sentence cannot carry — placements, samples, recording stories — and is off by default.
Every way it can decline leaves a store the floor has already filled.

**A claim with no source does not exist.** `facts.source_url` and `facts.source_quote` are
`not null`. The model is made to quote the words that state each fact, the quote must occur in the
article we sent (checked in code), and a second conversation that has never seen the article is
shown only the claim and the quote and asked whether one states the other. It is told to answer no
when unsure.

**Provenance survives to the console.** Every claim is on the enrichment panel with its category,
its quote and a link to the article.

## Answers to the questions the brief asked

- **Plugin or core?** Both, split at prose. The fetch is a plugin, the extraction is core.
- **Where does the fact store live?** `deadair.facts`, beside `track_enrichment` rather than inside
  it, because a provider's payload is an answer and a fact is an argument that keeps its evidence.
  Three nullable subject references rather than one polymorphic id, so a deleted track takes its
  facts with it.
- **Which source first?** Wikipedia only, end to end, as the brief guessed.
- **Test strategy for the non-deterministic passes?** The prompts are pure and unit-tested; the
  service is tested against a stubbed `LlmService` including a refusal, a malformed answer and a
  verifier that fails, all of which must yield zero claims rather than a throw. The SQL is covered by
  `apps/api/scripts/facts.smoke.ts` against the real database.
- **Playout tracking?** A cooldown on `facts.last_used_at`, stamped at selection. See below.

## Deliberately not built

- **Genius, Discogs, SecondHandSongs.** The seam is the point: once `documents` exists, a second
  prose source is one plugin and no host change. Songfacts stays excluded — right content, no API,
  unfriendly terms.

  **Genius is not the free one of those three, checked live 2026-09-02.** Its annotation prose does
  not arrive on its own: an annotation is attached to a referent, and the referent carries the
  highlighted lyric `fragment` plus up to 200 characters of the surrounding lyric on each side, which
  their own documentation recommends populating. So a Genius document handed to this path arrives
  with copyrighted lyric text welded to it, and `fact.lead.ts` takes an opening span verbatim as a
  claim with `source_quote` set to the same span. **That is `track-lyrics.md`'s hazard, on this
  file's path**, and the whole reason that file refuses to let a lyric arrive as a `SourceDocument`
  applies here unchanged: the floor extractor cannot decline. A Genius plugin would therefore need
  the referent's lyric spans stripped before anything became a document, which is a plugin-side
  obligation nothing in the host would enforce, and that is a poor place to put a rule of this kind.
  Two commercial facts sit on top of it: commercial use of their API is refused without a licence,
  stated above authentication in their own getting-started page, and the terms link in their API
  documentation resolves to the site terms, which prohibit scraping, data mining and reproduction for
  AI or machine-learning purposes without signed written consent. Discogs and SecondHandSongs are
  unaffected by any of this; the bullet keeps its shape, Genius just is not the cheap member of it.

  **Confirmed 2026-08-28**, by the second source arriving: `plugins/websearch` declares `enrichment`
  beside `search`, hands back `documents` from pages it read, and **no host file changed for it** —
  not the merge, not the walk, not the extractor. What it adds that this list did not anticipate is
  the case where the source is not a named service at all: the operator lists the sites they are
  happy to be quoted from and the plugin searches those.

  **Its trust boundary is the HOST's allowlist, not a check in the plugin, and that is the part
  worth copying.** The sites are a `list` config field with a column typed `url`, and
  `permissions.network` carries `{ fromConfig: 'trustedSites' }` pointed at the same field, so
  `host.fetch` refuses a page on any other domain before the plugin sees it. There is deliberately
  no `network.open` grant: with one this would be a plugin that reads whatever an engine ranked
  first and promises to be careful, and a claim store fed by that is a station quoting whoever won
  an SEO contest. The plugin filters the results too, which is only the cheaper way to the same
  answer — delete every line of it and the allowlist still holds.

  Two consequences for whoever wires the next one up. **Its documents come out ranked behind
  Wikipedia's** (`priority: 700` against 100), which costs nothing because `documents` is a list the
  host concatenates. And **the verifier is doing more work here than it was designed for**: against
  an encyclopaedia, checking a claim's quoted span against the source was mostly a guard against a
  model paraphrasing. Against an open index it is also the only thing standing between the fact
  store and a page that is confidently wrong. That is a reason to keep the trusted list short, and
  it is the honest argument for reading the enrichment panel occasionally rather than a reason not
  to have built this.
- **Categories driving persona selection.** The column is populated and nothing reads it. Wire it
  when there is a real corpus to see the distribution of, so a pirate captain's preference is set
  against what the store actually holds rather than against a guess.
- **Editing or deleting a claim from the console.** The panel is read-only. A write surface needs a
  permission decision and a rule about what a re-extraction does to a claim an operator has touched.
- **Fact retirement.** Chosen against. A fact said fifty times is still true, and a station whose
  good lines expired permanently would have less to say the longer it ran.
- **A stamp at AIRING rather than at selection.** `last_used_at` is written when a claim is handed to
  a writer, so a break that is later dropped by the forward-claim check still rests its facts. The
  honest alternative is a reader of `segment_events`, which is a great deal of machinery for the
  difference between "used" and "used and heard".

## What an operator has to do to turn it on

The Wikipedia plugin is bundled and discovered, but like every plugin it starts disabled and needs a
contact email address in its config before it will make a request — Wikimedia asks every client to
identify itself. Nothing else needs enabling: the walk and the floor run on cron from then on. The
model pass is `llm.factExtraction`, off by default.

The web search plugin is a second, optional source and takes one more step than Wikipedia does. It is
bundled and starts disabled; enabling it needs an engine and its credential, and that alone gives the
station the `search_web` tool and no documents at all. **The documents start when the operator adds a
row to "Sites worth quoting", and never before**: an empty list means the enrichment half makes no
request. That is the shape on purpose — the list is the operator saying which sites they would be
happy to hear the station quote.
