# Deadair todo/idea list

The raw list: unscoped, undesigned, and deliberately not held to the rules the rest of `docs/todo/`
follows. An entry earns a file of its own by being scoped against real code, and the line here then
points at that file. Checked against the tree on 2026-08-11.

- [ ] shows should use personas
- [ ] more voices, add phonetics
- [~] inject news/weather breaks — half done for news, 2026-08-15. The SOURCE is built (`news`
      capability, `plugins/rss`, `NewsService`, a `read_news` tool the DJ can call mid-break), and it
      arrived as a capability of its own rather than behind the `tool` capability `tool-plugins.md`
      expected. What is left is the BULLETIN — a `news` segment kind and its writers — scoped in
      `news-and-bulletins.md`. Weather is still unstarted; what the station knows about the hour and
      the season is `station-moment.md`
- [ ] traffic breaks?
- [ ] breaking news instant breaks — scoped in `news-and-bulletins.md` §2, and deliberately not a
      news feature: a host-side watcher over any polled source that posts a `BreakRequest`, so a new
      number one and a weather warning are the same loop. The de-duplication contract it needs is
      already on the `news` capability
- [ ] persona memory
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
- [ ] have the talk shows (like conspiracy) keep a history so it can grow organically
- [ ] view saved track metadata
- [ ] like/dislike artist/song/album maybe genre — operator dislikes and never-play predicates are
      `station-intelligence.md` §5, the accountless listener version is §7
- [ ] integrate with genuis for enrichment
- [x] drop the plugin kind and only use capabilities — done; a manifest has one axis and
      `plugin.manifest.ts` records why