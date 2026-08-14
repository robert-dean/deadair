# Fact Enrichment for Deadair

Status: design brief, not yet implemented
Owner: Robert
Intended reader: Claude Code, in plan mode, with access to the deadair repo

## Goal

Give the DJ personas real, verifiable trivia to talk about between tracks. The
target quality bar is a fact like: "Hammer Smashed Face by Cannibal Corpse
appeared in Ace Ventura: Pet Detective." Specific, checkable, and interesting
to a listener who already likes the song.

## Non-goals

- No fact generation at airtime. Enrichment is an offline job.
- No unsourced facts. If a claim has no source URL, it does not enter the store.
- Not building a general music metadata cache. This is trivia only. Existing
  metadata paths stay as they are.

## The core problem

Almost none of this content lives in structured music metadata. It lives in
prose. So the pipeline is: fetch prose, extract structured claims, verify the
claims against the source text, cache, then let the script generator draw from
the cache.

## Sources, in rough order of value

1. **Wikipedia / Wikidata.** Highest hit rate. Fetch full article text via the
   REST API for track, album, and artist. "In popular culture" and "Legacy"
   sections are the richest. Film articles carry soundtrack sections.
2. **Genius API.** Song descriptions and annotations are effectively
   crowd-written trivia. Strong for placements, samples, origin stories.
3. **Discogs.** Release-level color: studio, engineer, pressing oddities,
   artwork controversies.
4. **MusicBrainz.** Not a fact source so much as the connective tissue.
   Recording / work / artist relationships, and stable MBIDs to key the cache
   on.
5. **SecondHandSongs** for covers and originals. **WhoSampled** for samples,
   but there is no friendly public API, so treat it as optional or manual.

Explicitly excluded: Songfacts. Exactly the right content, no API, unfriendly
terms.

Check current rate limits and terms for each before wiring it up. Assume they
have changed since this brief was written.

## Data model

Facts are stored as structured claims, not as broadcast-ready sentences. The
persona and script generator do the phrasing.

Rough shape, adjust to fit the existing schema conventions:

    {
      subjectType: 'track' | 'album' | 'artist',
      subjectId,          // MBID where possible
      claim,              // one sentence, neutral phrasing
      category,
      sourceUrl,
      sourceQuote,        // the span that supports the claim
      confidence,
      extractedAt
    }

Categories matter more than they first appear. Suggested starting set: film or
TV placement, chart performance, recording, personnel, controversy, cover or
sample, death or breakup. Categories are what let the pirate persona pick a
different fact than a 2am ambient host, and they give the script generator
something to build an outline around.

## Pipeline

Enrichment runs when a track enters the library or the upcoming queue, never
during playout.

1. Resolve the track to an MBID.
2. Fan out to the sources, collect raw prose.
3. Extraction pass: LLM turns prose into structured claims.
4. Verification pass: a second call sees only the claim and the source text and
   answers whether the text supports the claim. Unsupported claims are dropped.
   This is cheap and kills most hallucination.
5. Write surviving claims to the fact store.

## Guardrails

- **No empty-handed invention.** If the fact store returns nothing for a track,
  the script generator gets an explicit "no facts available" signal and a patter
  path that works without one. It must not be allowed to improvise a fact.
- **Playout tracking.** A `factPlays` table with per-fact cooldowns, so the Ace
  Ventura line does not run every third rotation. A freshness flag retires a
  fact after N airings.
- **Provenance survives to the output.** Every aired fact should be traceable
  back to a source URL for debugging when something sounds wrong on air.

## What I want out of the plan

- How this fits the existing job / worker system and the plugin interrupt model.
  Should enrichment be a plugin, or core?
- Where the fact store lives relative to current persistence.
- The integration point with script generation, specifically the multi-pass
  outline approach currently being worked on.
- Which source to build first as a vertical slice. My instinct is Wikipedia
  only, end to end, with the verification pass in place from day one.
- Schema migrations required.
- Test strategy for the extraction and verification passes, which are
  non-deterministic.

Read the relevant code before proposing any of this. Where the brief conflicts
with how the codebase actually works, the codebase wins. Flag the conflict.
