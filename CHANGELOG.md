# Changelog

Notable changes to deadair, newest first. Versions follow [semantic
versioning](https://semver.org). An entry is written from the changesets a version pull request
consumed, and a version exists once that pull request is merged and its build passes, which is when
it is tagged `v*` and published. The `deadair/deadair:latest` image follows `main` and is not a
release. The listener apps keep their own changelogs, in
[apps/android](apps/android/CHANGELOG.md) and [apps/desktop](apps/desktop/CHANGELOG.md).

## [Unreleased]

## [0.3.0] — 2026-09-12

- A talk break can now be read hushed or frantic. The model writing it chooses, and only when the speech engine can perform it: on Chatterbox that means the original or multilingual model, since the Turbo model performs laughs and sighs instead and ignores these dials. Each Chatterbox voice can also carry its own exaggeration and CFG weight, which sets how theatrical that character is at rest, and Test connection says whether the loaded model uses them. The segments page shows a break's reading beside its voice, and speech plugins get a documented way to translate the same two words into whatever their engine has.
- A plugin can now be imported from Settings → Plugins, as the tarball `npm pack` writes, with no shell on the box. It arrives switched off, as one copied in by hand does. Importing a newer version of an installed plugin replaces the old one and takes effect at once, with its settings kept; importing the same version again says the station needs a restart to run it. An installed plugin can also be removed from its page, which deletes its folder and keeps its settings.

## [0.2.4] — 2026-09-12

- Shuffling the running order while nobody is listening no longer makes the station jump to the record it had lined up before the shuffle when a listener arrives, skipping everything the shuffle put in front of it. The shuffled order now plays from its new first record, and the same holds for moving or adding an item at the head.

## [0.2.3] — 2026-09-11

- An audition now keeps what the model wrote for a break the station refused, beside the reason, so a decline such as "read a sample line back" can be checked against the words.
- The presenter no longer reads a reissue's "2014 remaster" or "2004 remix" out as part of a title, and a break that names such a record by its plain title is no longer refused for naming neither record.
- A break that says the sky is doing something it is not ("Night falls" in the afternoon, "Sunrise" at eleven) now goes to the floor like one that says "tonight" at the wrong time. Night and sunrise in the host's own story, in similes and in record titles are still allowed.

## [0.2.2] — 2026-09-11

- The presenter no longer reads a reissue's "2004 Remix" out as part of the title, and no longer doubles a full stop after a name that already ends in one, such as R.E.M.

## [0.2.1] — 2026-09-11

- The plugin SDK on npm is now published by the release itself, with a provenance attestation that ties each version to the commit and the workflow run that built it. 0.2.0 was published by hand and has none. Nothing in the SDK's API changes.

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

[Unreleased]: https://github.com/robert-dean/deadair/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/robert-dean/deadair/compare/v0.2.4...v0.3.0
[0.2.4]: https://github.com/robert-dean/deadair/compare/v0.2.3...v0.2.4
[0.2.3]: https://github.com/robert-dean/deadair/compare/v0.2.2...v0.2.3
[0.2.2]: https://github.com/robert-dean/deadair/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/robert-dean/deadair/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/robert-dean/deadair/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/robert-dean/deadair/releases/tag/v0.1.0
