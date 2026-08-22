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
- [~] talkshows with callers (can we do real and fake like a conspiracy theories ) — **the machinery
      is built, 2026-08-16**: a production is several beats written in several passes that airs as one
      block (`modules/productions`, `produced-episodes.md`), which is what a talkshow is made of. Two
      things are missing and neither is the hard part: the CAST, since `OutlineBeat.lead` and
      `Production.voices` exist and nothing reads them (a caller is a persona, per `personas.md`), and
      a schedule to commission one, which is `director-and-lineups.md`
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
- [ ] add foley, sounds, etc (especially useful for "callers" so you hear background noise like a dog barking)
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
- [ ] have the talk shows (like conspiracy) keep a history so it can grow organically — this is
      `persona memory` above wearing a different hat, and `personas.md` §2 says so: a show that
      remembers is a persona that remembers, and building it twice gives the station two characters
      with one name
- [ ] view saved track metadata
- [ ] like/dislike artist/song/album maybe genre — the dislike half is BUILT (a `-1` rating at all
      three levels, collapsed by `effectiveRating`); the genre half is `never-play-rules.md`, and the
      accountless listener version is `station-intelligence.md` §7
- [ ] integrate with genuis for enrichment — note that the Genius API returns no lyric TEXT, only
      metadata and annotation anchors, so this is an annotations integration and belongs to
      `fact-enrichment.md` (third-party prose the host can extract sourced claims from) rather than
      to lyrics. `track-lyrics.md` says so under "Where lyrics come from"
- [ ] track lyrics as enrichment — scoped in `track-lyrics.md`. The rule everything follows from is
      that a lyric may be read by the host and never said on air, which is why it must not arrive as
      a `SourceDocument`: the deterministic fact floor would take the song's first line as a sourced
      claim and the DJ would recite it with a citation. The phase worth building first needs no model
      at all, a synced lyric's first timestamp as the talk-up limit
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