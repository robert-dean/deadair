# Deferred: finding the clean copy the library does not hold

**Written:** 2026-08-16, from building the advisory policy.
**State of the tree:** the policy is built and shipped. `track_sources.advisory` holds
`explicit` / `clean` / null, `rotation.advisory` is `prefer-explicit` / `prefer-clean` /
`clean-only`, and `CandidatesRepository.bindingsFor` chooses between the copies the catalog already
has. What does not exist is anything that goes LOOKING for a copy the catalog does not have.

---

## What was built, and exactly where it stops

A clean edit and the explicit original are one `deadair.tracks` row with two `track_sources`
bindings, because `resolveTrack` matches on `title_key` + artist and the clean edit's own ISRC
misses. So the whole policy is binding selection, and it is honest as far as it goes:

- `prefer-clean` takes the clean binding **if the library already holds one**.
- `clean-only` refuses the work outright if it does not.

The gap is the "if". The library is filled by walking the connected account's playlists, so it holds
whichever copy those playlists happened to carry — and a playlist of explicit originals produces a
library where `prefer-clean` leans on nothing and `clean-only` refuses records whose clean version
the provider is perfectly willing to serve. That is the same shape as the gap `ProviderTrackLookup`
was built to close for a record the library had never heard of at all.

## Why this is a separate mechanism and not a flag on the existing lookup

`ProviderTrackLookup` is STRICT on purpose, and its own file says why: a near-miss does not raise an
error, it airs the wrong record. Both the normalized title and the normalized lead artist must match
exactly, and duration only breaks a tie between candidates that already matched.

A clean-copy search needs the exact opposite of that on one axis and MORE than it on another:

- **Looser on the title**, because the clean copy is frequently titled differently — `(Clean)`,
  `[Clean]`, `(Radio Edit)`, `(Edited)`, `(Clean Version)`, and combinations with a feature credit
  already in the title. Matching on `normalizeKey` alone finds nothing in exactly the cases this
  exists for.
- **Stricter on identity**, because "loose title match under the same artist" is a very good way to
  find a live version, a remix, a cover, or a different song on the same album. The thing being
  matched is a RECORDING, not a name.

Putting both behaviours behind a flag on one class would give the strict path a mode in which it is
not strict, which is the property the whole ingest path rests on. So: a separate class, and the
existing one untouched.

## The shape it would take

**Where it drops in.** `PickResolver`, after `identify` and before the rules — the same slot
`discover` occupies, and for the same reason: a copy taken in has to become a real binding, because
the player fetches every record through `track_sources` and a copy with no binding has no URL. It
runs only when the policy is `prefer-clean` or `clean-only` AND the work's existing bindings are all
explicit or unmarked. Under `prefer-explicit` it is inert.

**The matcher.** Search the provider for the artist plus the base title, then score candidates:

1. Strip the edit markers from both sides before comparing (`(Clean)`, `(Radio Edit)`, `(Edited)`,
   `(Clean Version)`, `(Album Version)`), then require an exact `normalizeKey` match on what is left.
2. Require the lead artist to match exactly, on `normalizeKey`, as everything else in this codebase
   does — see `pick-artist-matching.md` for what a credit line in that field costs.
3. Require the candidate to report `advisory: 'clean'`. This is the whole point: a candidate that
   does not positively say is not a clean copy, it is an unmarked one, and taking it would smuggle
   the "silence is consent" reading in through the back door after the policy deliberately refused
   it.
4. Break ties on duration within a couple of seconds, exactly as `ProviderTrackLookup` does. A clean
   edit that is thirty seconds shorter is a radio edit as well, which is a different recording and a
   different question — see below.

**The cache is the reason to build it at all.** The pairing between an explicit track id and its
clean counterpart is PERMANENT: it is a fact about two rows in a provider's catalog and it does not
change. So the search must happen once per record ever, not once per refill, and the result has to
be stored — including the NEGATIVE result, since "this record has no clean version" is the common
answer and re-searching for it every hour would spend a provider's whole rate budget on records that
will never have one. A miss needs to be distinguishable from "never looked", the way
`fact_extractions` exists so a pass can tell an article that yielded nothing from one it never
opened.

## Two things deliberately out of scope

**A radio edit is not a clean edit.** They are correlated and they are not the same axis: an edit is
a LENGTH cut and may still be explicit. The `advisory` column is about lyrics alone, and an
edit-length preference — a station that wants the 3:30 version rather than the 7:00 album cut —
belongs in its own field on the day something wants it. Do not widen this one to carry it, and do
not let the matcher's `(Radio Edit)` stripping quietly turn into an edit-length preference.

**The account-level filter is still not enforced.** See below.

## The measurement this was deferred with

An operator's own Spotify account can have explicit content turned off, and that decision sits above
the station's. The plugin now READS it — `explicit_content.filter_enabled` and `filter_locked` off
`GET /me`, on a profile call it was already making — and reports it in `testConnection`'s message and
once in its log. It does not act on it, and the reason is that nobody has measured whether it binds:
the station's audio comes through the shim rather than the Web API, so whether that filter actually
refuses the bytes is an open question and asserting either answer in code would be a guess.

**Settle it before building any of the above**, because the answer changes what this doc is worth. On
an account with the filter on, ask `TrackAudioService.ensure` for a binding marked
`advisory = 'explicit'` and watch whether the bytes arrive.

- If they do, the filter is a Web API concern, the plugin's message stays purely advisory, and the
  matcher above is the whole of the remaining work.
- If they do not, the plugin has a real basis for reporting explicit copies as unplayable, and there
  is already a column for exactly that: `track_sources.playable`, documented as "the provider still
  knows the track but will not serve it here". That would make a clean-copy matcher considerably
  more valuable, because a filtered account currently degrades into four failed fetches and a benched
  binding with nothing in the log connecting it to a checkbox.

Write the answer back into this file either way. The question is cheap to settle once and expensive
to keep re-deriving.
