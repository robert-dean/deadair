# Changelog

Notable changes to deadair, newest first. Versions follow [semantic
versioning](https://semver.org). An entry is written from the changesets a version pull request
consumed, and a version exists once that pull request is merged and its build passes, which is when
it is tagged `v*` and published. The `deadair/deadair:latest` image follows `main` and is not a
release. The listener apps keep their own changelogs, in
[apps/android](apps/android/CHANGELOG.md) and [apps/desktop](apps/desktop/CHANGELOG.md).

## [Unreleased]

## [0.8.0] — 2026-09-15

- API keys, for a script or an integration that should reach the station without your password. Settings → Security has a new card to create one, read-only or read-and-manage, with an expiry if you want one; the key is shown once, and can be rotated or revoked from the same card. A key acts as your account and never does more than it can, so a listener's key only reads. It cannot sign in, change how you sign in, or make other keys. Send it as `Authorization: Bearer da_…`.

## [0.7.1] — 2026-09-14

- A break that uses a time of day in a comparison ("the riffs hit like an unmarked car at midnight", "smooth as a midnight train") is no longer sent to the floor for naming the wrong time. Saying it is midnight when it is not is still refused.

## [0.7.0] — 2026-09-14

- The typed client for the station's API is published to npm as `@deadair/sdk`, beside the plugin SDK, carrying the station's version, so the SDK that shares a station's version number is the client for that station. It is the client the console is built on, with Luxon's types now among its dependencies so a TypeScript project gets typed dates without installing them itself. The repository has a small example client in `examples/sdk/now-playing`, which CI builds against the SDK as it would be published.

## [0.6.0] — 2026-09-14

- The station now restarts its audio chain when it gets stuck. The audio chain can stop playing what it is handed while still looking alive, which leaves listeners on the fallback bed until somebody restarts the container. Now, if it holds a record for a minute without playing it, or does not answer at all for a minute, the station asks for it to be restarted, and it is back within about twenty seconds with the running order where it was. It asks at most once every five minutes and gives up after three restarts that did not help, and every restart, and giving up, is in the activity feed. A stuck audio chain is also now killed after ten seconds if it will not stop on its own, including when a stream setting changes. The new "Restart the audio chain when it gets stuck" setting under Playout is on by default; turn it off to leave a stuck chain alone and look at it.

## [0.5.1] — 2026-09-13

- Mail works with a server that has a self-signed certificate. Settings → Mail has a new switch, "Check the server's certificate": turn it off and the station stops failing with "unable to verify the first certificate" against a mail server with its own certificate, or one from your own certificate authority. It stays on by default, and should for any server reached across the internet, because with it off the station cannot tell your server from something pretending to be it.

## [0.5.0] — 2026-09-13

- `GET /nowplaying` now says what programme is on and who presents it, and whether the station is playing a record or talking. The new `show` field carries the broadcast's name and the host's on-air name: the persona's own on-air name, or the station's presenter name from Settings when the persona has none, and nothing when neither is set. The persona's console label is never shown. `track.kind` is `record` for music and `break` while the station speaks on its own between records, such as an ident, a bulletin or a talk break; during a break `artist` is empty and `title` is the break's label. A presenter talking over the start of a record still counts as the record. Both fields are additions, so existing players keep working, and a station on an older version reads as always playing a record with no show named. The route still answers without touching the database, so polling it costs the station nothing more than before.
- The check-up's list of mounts ends with Open in the desktop app, which hands this station's address to the desktop app.

## [0.4.2] — 2026-09-13

- A break whose audio could not be made because the speech engine was not ready is now asked for again, instead of being passed over at its slot. When the voice server is still loading its model, or cannot load it because another model is holding the GPU, the station keeps the break's words and waits. Nothing ever came back for those breaks: only a welcome was tried a second time, so every other break turned away at the start of a listening session was lost. The station now asks for their audio again each time a record changes while the break is still coming up, and the activity feed says so, as it already did for a break whose render failed outright.

## [0.4.1] — 2026-09-12

- The console's Copy buttons work when it is opened over plain HTTP at a network address, such as `http://192.168.1.10:8080` on a home server. Before, they copied nothing there and said nothing either, because the browser only offers the clipboard function they used on HTTPS or on localhost. They now fall back to the browser's older way of copying, and if that is refused as well the button reads "Copy failed" and shows the text already selected, ready to copy with the keyboard. This covers the restart command on the silence diagnosis and the stale-config alert, the plugin OAuth callback URL, the authenticator key during enrolment, and the build revision and stream addresses on the check-up.

## [0.4.0] — 2026-09-12

- Smart shuffle: records the station has aired lately are now less likely to come round again soon, so the rotation works through more of your library before it repeats itself. It is a lean rather than a rule. A record that has just aired keeps a quarter of its usual chance of being drawn and warms back up evenly over a fortnight, anything outside the repeat window can still play, and a small library still plays everything it holds. It is on by default, and Settings > Rotation has a Smart shuffle switch and the number of days a record stays cold. The similarity mix leans the same way, taking a fresher record from each similar artist rather than always their best known, and a model choosing records now sees on each search result how many days ago it aired, so it can prefer one it has not played lately. Turning it off restores the previous behaviour exactly. The Shuffle button on the desk is smart too: it keeps one artist off its own heels and moves anything aired lately toward the back of what it shuffles.
- The console works when it is opened over plain HTTP at a network address, such as `http://192.168.1.10:8080` on a home server. Before, every request it made failed in the browser before reaching the station, because the browser only offers one of the functions it used on HTTPS or on localhost, and the console reported that as "Can't reach the station". Enrolling an authenticator app or an email address from a console reached that way works too; it failed for the same reason.
- Signing in with Google now comes back to the station instead of the console's not-found page. The station told Google to return the browser to an address the console answers rather than the API, so the sign-in finished at Google and went nowhere. The address is now `<public address>/api/auth/login/oidc/callback`, and it is the one to register as the authorized redirect URI in the Google Cloud console: an OAuth client still registered with the old address is refused by Google until it is changed.

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

[Unreleased]: https://github.com/robert-dean/deadair/compare/v0.8.0...HEAD
[0.8.0]: https://github.com/robert-dean/deadair/compare/v0.7.1...v0.8.0
[0.7.1]: https://github.com/robert-dean/deadair/compare/v0.7.0...v0.7.1
[0.7.0]: https://github.com/robert-dean/deadair/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/robert-dean/deadair/compare/v0.5.1...v0.6.0
[0.5.1]: https://github.com/robert-dean/deadair/compare/v0.5.0...v0.5.1
[0.5.0]: https://github.com/robert-dean/deadair/compare/v0.4.2...v0.5.0
[0.4.2]: https://github.com/robert-dean/deadair/compare/v0.4.1...v0.4.2
[0.4.1]: https://github.com/robert-dean/deadair/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/robert-dean/deadair/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/robert-dean/deadair/compare/v0.2.4...v0.3.0
[0.2.4]: https://github.com/robert-dean/deadair/compare/v0.2.3...v0.2.4
[0.2.3]: https://github.com/robert-dean/deadair/compare/v0.2.2...v0.2.3
[0.2.2]: https://github.com/robert-dean/deadair/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/robert-dean/deadair/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/robert-dean/deadair/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/robert-dean/deadair/releases/tag/v0.1.0
