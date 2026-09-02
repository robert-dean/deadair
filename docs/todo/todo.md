# Deadair todo/idea list

The raw list: unscoped, undesigned, and deliberately not held to the rules the rest of `docs/todo/`
follows. An entry earns a file of its own by being scoped against real code, and the line here then
points at that file. Checked against the tree on 2026-08-11.

- [~] shows should use personas — personas are BUILT (`deadair.personas`, the sheet, the voice, the
      templates chain, the voice), and `station_lineup.persona_id` already lets a broadcast
      name its own host. What is left is scoped in `personas.md`: §3 is the schedule writing that
      column, §5 is what the station says when a boundary changes the host, and §1 is the
      newsreader, which is the first case one-persona-per-station could not express
- [x] more voices, add phonetics — DONE. Phonetics is `deadair.pronunciations`, mined out of the
      articles the fact store already holds by `pronunciation.gloss.ts`, with a console page. Voices
      took four pieces: the map moved from a one-line box to a table whose engine cell offers what
      the server actually reports, a second engine arrived (`plugins/chatterbox`, with the model
      lifecycle a GPU engine needs), both plugins ship a curated twenty-slot map so a fresh install
      has named voices rather than one, and all 19 seeded personas name their own. What is left is
      not "more voices" but reaching more of what the second engine can do — cloning and the
      expressiveness dials on its native path, and an upload route for clips and voicepacks. Both in
      `dj-voice.md`
- [~] inject news/weather breaks — **news is done, 2026-08-15**: the `news` capability, `plugins/rss`
      and `NewsService` under a `read_news` tool the DJ can call mid-break, plus a `news` segment kind
      that `:30 news` on the station clock produces, with a model writer over a floor that reads
      published headlines as published. It arrived as a capability of its own rather than behind the
      `tool` capability `tool-plugins.md` expected; the reasoning is in `news-and-bulletins.md`.
      Weather is still unstarted; what the station knows about the hour and the season is
      `station-moment.md`
- [ ] traffic breaks?
- [ ] breaking news instant breaks — scoped in `news-and-bulletins.md` §2, and deliberately not a
      news feature: a host-side watcher over any polled source that posts a `BreakRequest`, so a new
      number one and a weather warning are the same loop. The de-duplication contract it needs is
      already on the `news` capability
- [x] persona memory — **BUILT 2026-08-22**, as `personas.md` §2 scoped it. `script_history` carries
      a `persona_key` now, `deadair.persona_notes` holds what each character has accumulated, and the
      two kinds are two different claims: what it actually SAID goes into use with the broadcast line
      as its evidence, what it has SETTLED INTO is proposed because nothing can verify an inference.
      A trait reaches the system turn beside the sheet and a saying the user turn beside the show's
      memory; a bulletin gets neither. What is left is the operator's opinion of a break, which is
      `break-ratings.md`
- [~] talkshows with callers (can we do real and fake like a conspiracy theories ) — **the FAKE half
      is built, 2026-08-25**. A caller is a persona of kind `caller` that can never go on air by
      itself; a `callin` production is planned as short alternating TURNS rather than beats, one
      segment and one voice each; who rings in is a rotation over the roster, least recently heard
      first; and a caller whose sheet carries a `latitude` may say what it THINKS, with the host's
      next turn told to take it as theirs rather than confirm it. Five callers ship, both speech
      plugins map them, and `:40 callin` on the station clock commissions one. What is left is the
      REAL half — a listener actually getting through — which is the request bot two lines down
      wearing a different hat, and is an inbound surface and a permission before it is anything about
      personas
- [ ] telegram bot for "requests"
- [ ] fix the tune-in album art, etc
- [ ] improve playlist generation, use similar artists to get related artists ect to help
    - similarity comes from Last.fm (`artist.getSimilar` / `artist.getTopTracks`), not MusicBrainz — MB has no artist-similarity endpoint
    - plus: durable play history (repeat window + artist cooldown), per-artist caps, palette from what aired instead of the pool
    - the repeat window, the artist cooldown and the per-artist cap are BUILT (`rotation.rules.ts`).
      What is left is scoped in `station-intelligence.md`: similar-artist expansion, palette
      steering, and "The bubble, which the rules above cannot fix"
- [ ] schedule builder (9-9:30 news, 9:30-12 music, 12-1 ?, etc)
- [ ] generate fake ads and sponsors
- [ ] more music sources (pandora, ?): youtube music and apple music appear to be hard to impossible
    - scoped since: `youtube-music.md` splits it into a catalog half that is ordinary plugin code
      and an audio half that is a second track fetcher and a sidecar
- [~] add foley, sounds, etc (especially useful for "callers" so you hear background noise like a dog
      barking) — the callers are real, the DELIVERY half came with them (`SPEECH_CUES` is eight, and
      a caller may cough, clear its throat, sniff or groan where a presenter keeps the original
      four), and the SOUNDBOARD landed 2026-08-26: `deadair.pads`, a board per persona, `[sfx:name]`
      in a script, and the render path splitting at the marker to join the takes around the sound.
      The mixing that was blocking this happens in the `analysis/` sidecar, as predicted, and never
      in Node.
      A production BEAT carries one too, host-only: a caller is never offered a board, because the
      board is in the studio and they are on a telephone, and the programme's ceiling is two rather
      than the break's one-per-segment. And a pad belongs to the LIBRARY with named SETS over it
      (`deadair.pad_sets`, `topics`' shape), so one air horn serves six characters without six copies
      and one library can be cut two ways.
      **No stock pack ships**, and that is a decision rather than a gap:
      `docs/decisions/pad-licensing.md` refuses attribution-requiring audio outright, because a radio
      station has nowhere to put a credit and the obligation would travel silently to whoever
      installed this. What is built is the machinery — `assets/pads/MANIFEST.json` for per-file
      provenance including a checksum and the uploader who ASSERTED the licence, and a first-boot
      copy guarded on the library being empty so a stock sound thrown away stays thrown away. What is
      left is sourcing verified CC0 audio, which is a research task with a legal edge rather than a
      coding one.
      What is still open is the thing this line was actually asking for. A dog barking BEHIND
      somebody is not a pad: a
      pad is a sound at a MOMENT, and this is a bed running under a whole turn, so it wants
      `AudioJoin.overlays` given a SPAN instead of an anchor. `MAX_OFFSET_MS` names that boundary in
      as many words — past about three seconds a sound starting before the words end has stopped
      being the same moment and become a second thing happening
- [x] console/logs/activity feed — built 2026-08-13, with the silence diagnosis it was paired with
      in `station-intelligence.md` §8. `GET /activity` unions `station_events`, `segment_events` and
      `play_history`; the console draws it at `/activity`
- [~] offer multiple LLM options (chatgtp, claude, ect) along with models — half done: `llm` is a
      capability and `plugins/llm` speaks the OpenAI-compatible protocol, so one plugin covers a
      local server and a hosted one. The MODEL is a per-call parameter, deliberately
    - [ ] Enable the breaks, shows, etc to be configured to use a specific one — the per-call
      parameter is the seam this needs; nothing chooses per break yet
- [x] plugin system for sources, renderers, streamers, enrichment, discovery, breaks? — built, as
      capabilities: `catalog`, `stream`, `enrichment`, `speech`, `llm`, `analysis`. See
      `packages/plugin-sdk/README.md`. Breaks are host-side and stay that way
- [ ] integrate with HA, similar? — the seam either way is a station API something outside this tree
      can drive, which the contracts already generate a typed client for. `comparable-stations.md`
      notes the adjacent version of it (an MCP surface, split into unauthenticated reads and admin
      actions) and that choosing which verbs an outside agent may reach is `service-actors.md`'s
      question wearing a different hat
- [ ] daily snapshot from calendar integration?
- [x] have the talk shows (like conspiracy) keep a history so it can grow organically — **BUILT
      2026-08-25**, and it cost no schema, exactly as `personas.md` §2 predicted by pointing at
      `persona memory`: a show that remembers is a persona that remembers. `persona_notes` and
      `persona_stories` are keyed by a persona KEY and know nothing about breaks, so the only thing
      missing was that a production wrote no `script_history` at all. It does now, one row per write
      attempt with the SPEAKER's key on it — so a caller's turns become the caller's notes, the
      nightly distil pass reads them without being told about productions, and a caller who has rung
      before is offered its own past on its first turn of the next call
- [ ] view saved track metadata
- [ ] like/dislike artist/song/album maybe genre — the dislike half is BUILT (a `-1` rating at all
      three levels, collapsed by `effectiveRating`); the genre half is `never-play-rules.md`, and the
      accountless listener version is `station-intelligence.md` §7
- [ ] integrate with genuis for enrichment — an ANNOTATIONS integration, not a lyrics one, and it
      belongs to `fact-enrichment.md` rather than to lyrics. Two things checked live on 2026-09-02
      change what it would cost. An annotation arrives welded to the lyric line it annotates (the
      referent carries the highlighted fragment plus up to 200 characters of surrounding lyric on
      each side), so the annotation path inherits `track-lyrics.md`'s hazard rather than escaping
      it: the floor extractor would take that span as a sourced claim. And commercial use of the API
      is refused without a licence, with the documentation's own terms link resolving to site terms
      that prohibit reproduction for AI use without signed consent. `track-lyrics.md` has the detail
      under "Genius, corrected"
- [ ] track lyrics as enrichment — scoped in `track-lyrics.md`, and its provider table was verified
      live on 2026-09-02. The rule everything follows from is that a lyric may be read by the host
      and never said on air, which is why it must not arrive as a `SourceDocument`: the deterministic
      fact floor would take the song's first line as a sourced claim and the DJ would recite it with
      a citation. The phase worth building first needs no model at all: a pair of
      markers derived from a synced lyric, where the vocal starts AND where it stops. Measured on 60 of this station's own records: 59 matched, 52
      with synced timings, on the strictest match with no fallback ever reached. The first plugin is
      LRCLIB rather than the operator's library, because this install has no library
- [x] an explicit-content policy — done; `rotation.advisory` in three states over
      `track_sources.advisory`, per COPY because a clean edit and the explicit original are one
      track with two bindings. `clean-only` demands a positive `clean` rather than reading an
      unmarked copy as consent, which is why a library from a source that never marks anything plays
      nothing under it and says so. What is left is going looking for a clean copy the playlists
      never carried, scoped in `clean-copy-matching.md`
- [x] drop the plugin kind and only use capabilities — done; a manifest has one axis and
      `plugin.manifest.ts` records why
- [ ] fix the render race on plugin reload — scoped in `render-plugin-readiness.md`, with the log
      line. A `render.segment` job that runs while the speech plugin is initializing writes the
      break off as `failed`; a planted one burns a retry and a break waiting for its audio is lost
      outright. The race is fine, the write-off is not

[ ] settle the system and build an api that a plugin could use