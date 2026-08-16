# Deadair todo/idea list

The raw list: unscoped, undesigned, and deliberately not held to the rules the rest of `docs/todo/`
follows. An entry earns a file of its own by being scoped against real code, and the line here then
points at that file. Checked against the tree on 2026-08-11.

- [~] shows should use personas — personas are BUILT (`deadair.personas`, the sheet, the voice, the
      templates chain, the `music` line), and `station_lineup.persona_id` already lets a broadcast
      name its own host. What is left is scoped in `personas.md`: §3 is the schedule writing that
      column, §5 is what the station says when a boundary changes the host, and §1 is the
      newsreader, which is the first case one-persona-per-station could not express
- [ ] more voices, add phonetics
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
- [ ] persona memory — scoped in `personas.md` §2. The cheap half exists (a writer is shown the last
      six scripts of its kind), and it is keyed by KIND rather than by character and cannot outlive a
      segment, so the prerequisite is a `persona_key` on `script_history` before anything summarizes
      it
- [ ] talkshows with callers (can we do real and fake like a conspiracy theories )
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
- [ ] integrate with HA, similar?
- [ ] daily snapshot from calendar integration?
- [ ] have the talk shows (like conspiracy) keep a history so it can grow organically — this is
      `persona memory` above wearing a different hat, and `personas.md` §2 says so: a show that
      remembers is a persona that remembers, and building it twice gives the station two characters
      with one name
- [ ] view saved track metadata
- [ ] like/dislike artist/song/album maybe genre — operator dislikes and never-play predicates are
      `station-intelligence.md` §5, the accountless listener version is §7
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