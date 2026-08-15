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
