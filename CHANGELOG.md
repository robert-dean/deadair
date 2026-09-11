# Changelog

Notable changes to deadair, newest first. Versions follow [semantic
versioning](https://semver.org). An entry is written from the changesets a version pull request
consumed, and a version exists once that pull request is merged and its build passes, which is when
it is tagged `v*` and published. The `deadair/deadair:latest` image follows `main` and is not a
release. The listener apps keep their own changelogs, in
[apps/android](apps/android/CHANGELOG.md) and [apps/desktop](apps/desktop/CHANGELOG.md).

## [Unreleased]

## [0.2.0] — 2026-09-11

- A station can now run plugins it did not ship with. Copy a plugin into `plugins/` on the data volume and press Rescan: the station lends it its own SDK, where before every such plugin failed to load. The console marks a plugin you installed, and one that failed to load names the folder it was read from. The plugin SDK is published to npm as `@deadair/plugin-sdk`, and deadair.radio has a new section on writing, testing and installing a plugin, walking through a complete example.
- Navidrome's plugin page no longer shows the playback authorization card. That card authorizes the station's own track fetcher, which only Spotify uses. Navidrome was being offered a Spotify login it has no use for and, once enabled, a warning that every record would be dropped.

## [0.1.0] — 2026-09-09

The first release. Everything below has been running on one station for some time; what is new is
that there is now a number to name it by.

### The station

- **A running order, owned by one thing.** A forward lineup several hours deep, every item carrying
  its own state, with the director as its only writer — the console, the schedule and the model all
  post commands to it rather than writing it themselves.
- **A presenter that cannot be silenced by a model.** Breaks are written by a local or hosted model
  when one is configured, by the operator's own phrasings when none is, and by the station's own
  five underneath both. The floor cannot fail.
- **Facts, or nothing.** A claim the presenter states on air is a stored row carrying the sentence
  of source prose that supports it. A claim with no source is not expressible in the schema.
- **Personas that accumulate.** A character sheet, a voice, a notebook of what it has said and
  anecdotes it can tell, plus auditions and rehearsals that never reach air. Phone-ins are produced
  as a cast of personas trading turns, each its own model call, joined into one file before it airs.
- **Measurement before air.** A Python sidecar decodes each record and answers with its cue points
  and its loudness, so silence is trimmed and boundaries are sized from what the material does.
- **An answer to "why is it quiet".** Eleven ordered gates over one snapshot produce a single causal
  verdict, written to the station's own event log.
- **A format clock and a weekly schedule**, a catalog with the station's opinion of every record at
  three levels, and an activity feed of what actually happened.

### Around it

- **One container** carrying the station, its console, the audio chain, the stream server and the
  sidecar, in three variants: `slim`, `latest` and `full`.
- **Plugins** for music providers (Spotify, Navidrome), enrichment (MusicBrainz, Last.fm,
  Wikipedia), news (RSS), web search (SearXNG, Brave, Tavily), weather (Open-Meteo, the US National
  Weather Service, OpenWeatherMap), speech (Kokoro, Chatterbox), models, and the measurement
  adapter.
- **Listener apps** for Android and macOS, released separately and on their own schedules.

### Known limits

- **Images are `linux/amd64` only.** There is no arm64 build yet.
- **There is no MFA recovery code.** A lost authenticator is recovered against the database; the
  procedure is in the README.
- **`latest` follows `main`.** Pin `0.1` to track releases only.

[Unreleased]: https://github.com/robert-dean/deadair/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/robert-dean/deadair/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/robert-dean/deadair/releases/tag/v0.1.0
