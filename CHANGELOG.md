# Changelog

Notable changes to deadair, newest first. Versions follow [semantic
versioning](https://semver.org). An entry is written from the changesets a version pull request
consumed, and a version exists once that pull request is merged and its build passes, which is when
it is tagged `v*` and published. The `deadair/deadair:latest` image follows `main` and is not a
release. The listener apps keep their own changelogs, in
[apps/android](apps/android/CHANGELOG.md) and [apps/desktop](apps/desktop/CHANGELOG.md).

## [Unreleased]

## [0.12.2] — 2026-09-16

- Callers stop being offered as hosts, and a broadcast refuses one. `GET /personas` answers with the whole roster, hosts and callers together, because the personas page draws both — so narrowing it is each surface's own job, and three of them had never done it: the on-air "Presented by" menu, "Hosted by" on a slot or a briefing box, and a production's presenter. Picking a caller there was not cosmetic. `DirectorConsoleService.recast` checked only that the persona existed, so the caller presented the show and `SegmentRepository.recast` rewrote every break in the tail in the character of somebody whose whole premise is that they are phoning in. `recast` now refuses a caller with the sentence `PersonasService.setDefaultHost` already used, and every console surface that offers a host narrows through one `presents` predicate rather than four copies of `kind !== 'caller'`. `putOnAir` still takes a persona id on trust, deliberately and for its own reason, so the endpoint half of that path is unchanged.
- "Hosted by" says the station's own host with an apostrophe. Its description carried `’` as six literal characters, and a JSX string attribute is HTML-like: it processes HTML entities but no backslash escapes, so every surface that draws this field — the slot editor, the briefing box and the sustaining panel — read "Empty means the station’s own host."
- The deadpan wisecracking host's checkable words are re-measured over 694 of her own scripts, after three auditions of the same playlist. `that was a choice` becomes `was a choice`, which catches the "That indeed was a choice" form that was being refused without being loose enough to insert as a noun; `somebody was paid to`, which fired on none of the 694, and `marvellous`, which fired on four, give their places to `one might` and `perhaps`. Her `avoid` list gains the critic's vocabulary the first pass missed — `merely`, `exercise`, `substance`, `spectacle` — and a persona's `avoid` cap rises from 12 to 16 so a sheet can forbid a whole register rather than a handful of phrases, which is what `slacker` and this character both need it for. Her diction now caps the number of her own phrases per break as well as the number of asides, since one audition break carried three.

## [0.12.1] — 2026-09-16

- The deadpan wisecracking host seed stops reviewing records. An audition of twenty breaks came back as record reviews with one of her phrases bolted to the end ("the production, shepherded by Mike Clink at Rumbo Recorders, offers a veneer of technical polish"), which passed her own character check every time because the phrase was present. Three changes: her opening quirk now states the move rather than the attitude (take one decision somebody made, literally, and say what it promised); a new quirk forbids reviewing the record at all; the critic's vocabulary is in `avoid`, which is the only half of a sheet that refuses a script rather than asking; and she carries `brevity: short` beside her `unleashed`, so she keeps the room to say anything and is told to say it in one line.

## [0.12.0] — 2026-09-16

- The persona flag that says who the station's own host is has been renamed from `active` to `defaultHost`, everywhere: the `personas.default_host` column (migration 0031, applied at boot), the `Persona` contract and all four SDKs, and `PUT /personas/{id}/active`, which is now `PUT /personas/{id}/default-host`. Nothing about who presents changes; the old name said "on air", which it never meant during a broadcast that named its own host, and the console badged the wrong character for exactly that reason. The Personas page button now reads **Make station host** rather than "Put on air", and the desk's persona pickers mark whoever is actually presenting. The operator desk on macOS follows the same rename, and its Voice page lamp now marks the character presenting rather than the station's own host.
- The Personas page now says who is **On air now** rather than marking the station's own host and calling that the same thing. They differ whenever the broadcast on air names its own host: the character presenting the show writes every break, while the station's own host is the one who takes over when a broadcast names nobody. That card is now badged **Station's own** instead. `Persona` gains a readonly `presenting`, derived per request from the running order through the same precedence a break uses, so it can never drift from who is actually speaking; the desk's "Presented by" badge reads it instead of working the fallback out for itself. The stored flag is unchanged and still `active`.
- Spotify playlists you follow but do not own now work. An editorial playlist, a Daily Mix, a playlist a friend made: all of them were listed with **Spotify won't share this playlist's tracks** and can now be viewed, aired, picked for a schedule block and used for a persona audition, because the station's own track fetcher reads them on the login it already holds for fetching audio. It needs that fetcher authorized (Plugins → Spotify → the playback authorization card); without one, those playlists read exactly as they did before.

  Two things follow from it. The hourly library sync now reads those playlists too, so the records in them join your library from the next run: hide a playlist from its card on the Playlists page to keep it out. And Spotify marks almost nothing on this path as clean or explicit, so a station set to **clean only** will play very little from a followed playlist, which is the honest outcome rather than a station vouching for records nobody vouched for.

  For plugin authors, `PluginTrackFetcher` gains `playlistTracks(request)` for the playlist your own API lists and then refuses.

## [0.11.1] — 2026-09-16

- The deadpan wisecracking host seed keeps the listener's taste as a target, beside the one it gained last release. She is rude about the decision to be sitting there listening to this AND about what somebody decided to call it, with the record itself as her evidence rather than her subject. The fence is two cuts of one kind: their taste is fair game and they are not, and a name somebody chose is fair game and the person who has it is not. A station that already has her keeps its own sheet: seeds are only written to an empty station, and "Restore built-ins" adds missing ones without overwriting.

## [0.11.0] — 2026-09-16

- Any playlist can now be hidden from its card on the Playlists page: open the **⋯** menu on the card and choose **Hide**. A hidden playlist moves into **Show N hidden** at the bottom of the page, is no longer offered in the schedule, sustaining and programme pickers or in persona auditions, and the library sync stops reading it, so records that only it held leave the library the way they would if the playlist were deleted. Choose **Show again** on its card to undo it; nothing is deleted. A schedule block or setting that already plays from a playlist you then hide keeps playing from it. The pickers also stop offering playlists their source refuses to share, since those could only fail at air time. Hiding needs an admin. New table `hidden_playlists` (migration 0030); `CatalogPlaylist` gains an optional `hidden`; new `PUT` and `DELETE /playlists/{pluginId}/{playlistId}/hidden`.
- The playlists Spotify makes for you (Discover Weekly, the Daily Mixes, Release Radar and its editorial lists) no longer fill the Playlists page with cards Spotify refuses to share. They now sit behind **Show N made by Spotify** under your own playlists, and the count at the top counts only the ones a person made. Nothing is removed: open the button and they are all there. For plugin authors, `ProviderPlaylist` gains an optional `madeByProvider`, and `CatalogPlaylist` carries it through.
- The running order on the Desk can now skip straight to a record further down it. Each record still to come carries a **Skip to** button beside Play next: pressing it passes over everything in front of that record, including anything the player had already been handed and the breaks between, cuts what is on air, and plays the record next. The records passed over show as skipped, and a break that was being written for one of them is written off. Only a record can be skipped to, not a break, since a break's words are about the records around it. With nothing on air, the order moves and the station starts from that record when it next airs. The new route is `POST /director/air/items/{itemId}/skip-to`, `skipToARunningOrderItem` in the SDK.
- The deadpan wisecracking host seed now makes fun of what a record is called rather than the record itself: the title, the band name, the album title, and the fact that somebody approved a sleeve. She likes the music and plays it straight, and she no longer goes after the listener's taste. A person's own name is off limits (she goes for the title instead), and because the writer is never shown the cover art, she may wonder who signed it off but never describes it. A station that already has her keeps the old sheet: seeds are only written to an empty station, and "Restore built-ins" adds missing ones without overwriting.

## [0.10.0] — 2026-09-15

- A playlist can now be aired with similar records mixed in, the way Spotify's smart shuffle does it. Every few records of the playlist, the station adds a record by an artist who sounds like the one just played, found through a similarity plugin such as Last.fm; the playlist itself still plays in full and in its own order around them. Choose **Air with similar records mixed in** from the arrow beside Air this playlist, or turn on **Mix similar records into a playlist** under Settings, Rotation to have every playlist do it, with the spacing beside it (four of the playlist's records between mixed-in ones by default). It is off by default, a setlist or a feature never has anything mixed in, and every mixed-in record passes the same rules and dislikes as anything else the station picks. A mixed-in record never lands beside a break, so nothing the presenter has already said about the next record is made wrong. The activity feed says how many were found, and says so when none could be. `PutOnAirInput` and `PlayoutPlaylistInput` gain an optional `mixInSimilar`.

  On the Desk, a record the station mixed in carries a **mixed in** badge, so you can tell it from the ones the playlist named. `StationOrderItem` gains an optional `mixedIn`.
- A similarity plugin can now name records that sound like one record, not only artists who sound like one artist. `SimilarityProvider` gains an optional `similarTracks(ref, limit)`, taking the enrichment capability's `TrackRef` and answering `ArtistTrack`s, each with its own lead artist. The Last.fm plugin implements it with `track.getSimilar`, asking by MusicBrainz recording id when the catalog has one. When a playlist mixes similar records in, the station now asks about the record each one follows first, and falls back to that record's artist when nothing usable comes back or no plugin can answer. A plugin without the method behaves exactly as before.
- A schedule block that plays a playlist can now ask for similar records to be mixed in among it. The block editor shows **Mix in similar records** whenever the block plays from a playlist; ticked, every changeover to that block mixes neighbours in the same way Air with similar records mixed in does, and left unticked the station's own **Mix similar records into a playlist** setting decides. `ScheduleSlot` gains an optional `mixInSimilar`, stored in a new nullable `schedule_slots.mix_in_similar` column (migration 0029).

## [0.9.0] — 2026-09-15

- `parseFeed` reads what a podcast feed carries. An entry now reports its audio attachment as `enclosure` (from RSS `<enclosure>` or an Atom `<link rel="enclosure">`, preferring an audio one, http(s) only), how long it runs as `durationMs` from `itunes:duration`, and its artwork, explicit marking, season and episode number. A feed reports its own description, author, artwork, language, categories and explicit marking. Every field is optional, and `url` is still only ever the page, so a news reader sees exactly what it saw before.
- A new `podcast` capability lets a plugin say what programmes the station subscribes to and what each has published: `listShows`, `listEpisodes` (newest first, each episode carrying the address of its audio, how long it runs by the publisher's account, and its summary), and an optional `searchShows` directory. The plugin never fetches the audio; the station fetches it itself, ahead of the slot it airs in. It is deliberately not a music provider, because an episode is not a record, and the README's new "Carrying podcasts" section says why.
- The station can fetch a podcast episode's audio into its own store, where it becomes a segment ready to air, with `POST /podcasts/episodes/{id}/fetch`. The download follows the analytics redirects podcast audio sits behind, refuses any address that resolves to this machine or its network, decides what the file is from its first bytes rather than from what the publisher says, and streams to disk under a 256 MB ceiling. On air an episode is named on the mount by its title and its show, reported to listeners as a programme rather than as the station talking, levelled from the loudness a mastered podcast has rather than the station's quieter speech engine, and kept out of play history and scrobbling. Episodes are never drawn at random from the segment shelf.
- A bundled Podcasts plugin reads the podcast feeds an operator subscribes the station to: one row per show with its feed address, each show described from its own feed, and its episodes listed newest first with the address of their audio and how long they run. It can also look a show up by name in Apple's public podcast directory, which is on by default, can be switched off, and can be pointed at a country's store. It never fetches an episode's audio itself, so the only addresses it asks to reach are the feeds and the directory. Nothing on the station uses it yet.
- The Library has a Podcasts tab. It lists the episodes the station knows about, newest first, with whether each is fetched, ready to air or aired, why a fetch failed, and a button to fetch one now or try again. It can read every feed again on request, and it can look a show up in Apple's podcast directory and subscribe to it, which adds the show to the Podcasts plugin's own list of feeds. `GET /podcasts/search` is the directory search behind it. Durations of an hour or more now read as hours everywhere in the console, including the desk's counters while a programme airs.
- The station keeps a record of the podcast episodes it knows about. Every half hour it reads the newest episodes of every show its podcast plugins carry and remembers each one, with what the feed said about it and, later, whether the station fetched its audio and whether it aired. `GET /podcasts/shows` lists the shows, `GET /podcasts/episodes` lists the episodes newest first, and `POST /podcasts/refresh` asks for a refresh now. The typed SDKs gain the matching `podcasts` client.
- The presenter hands over to a programme and comes out of it. When a podcast episode is scheduled and the station's breaks are on, a talk break is planted in front of it, and a break written beside a programme is told what it is: the show, the episode, how long it runs and what the publisher says it is about, described as a programme rather than as a record. A break that promises the programme is dropped if the programme leaves the running order. Lengths of an hour or more are given to the writer in hours and minutes.
- A podcast can go on the format clock. Add a show as a topic of the new `syndicated` kind, then put a `syndicated` band on the schedule about it: three hours before the slot the station fetches the show's newest episode, and at the slot it airs it, if it has not aired it already. A band declines rather than airing an older episode or a different show, and a programme is still carried when the station's own talking is switched off. An episode's stated length now counts on the station's clock, so a bulletin at the top of the next hour lands after the programme rather than an hour early, and a bulletin at the boundary a programme ends on is kept rather than dropped as a second break. Plugin settings can offer the shows the station carries with the new `station.podcastShows` option source.
- `parseFeed` no longer drops an entry whose title is written twice. A podcast entry usually carries both `<title>` and `<itunes:title>`, which arrive together once namespace prefixes are removed, and every such entry used to be discarded as untitled. The first readable one is now used, for every field read this way.

## [0.8.3] — 2026-09-15

- A programme booked on the format clock is commissioned once. The time a clock band next falls due used to carry the milliseconds of the moment it was asked, so every pass of the station's scheduler saw the same slot as a new one and could commission the same phone-in or podcast again, as often as every pass for the three hours before it aired.
- The eighties persona seed is now a valley girl, Tiffani, in place of the bright video-age jock. She talks in uptalk, loves whatever the station plays because it is on the radio, and cannot understand the music nobody plays. A station that already has the old jock keeps him: seeds are only written to an empty station, and "Restore built-ins" adds missing ones without overwriting.
- A title, artist or album the model wrote in markdown italics or bold (`*Electric Eye*`) now keeps its words and loses only the asterisks. Every `*...*` run used to be deleted as a stage direction, which aired breaks with a hole where the record's name had been and refused others for naming neither record they were shown. A run that reads as a stage direction (`*laughs*`, `*sighs*`) is still dropped.
- The valley girl seed is revised after her first audition. She uses "like" as a discourse marker (the filler, "I was like", and "like, four of them"), her uptalk is a statement going up rather than a question tacked onto the end, and her disgust slang is no longer spent as praise. She now stays loyal to a record on air that sounds like the music she cannot stand, and she no longer jokes about a death.

## [0.8.2] — 2026-09-15

- A pronunciation entry for a name that starts with punctuation (`?uestlove`, `.38 Special`) now matches. Taking a soundboard hit out of a script no longer closes every space in front of punctuation elsewhere in it, which had glued such names to the word before them, in the stored script as well as on the way to the engine.
- What a pronunciation entry says now reaches the speech engine exactly as it was written. A respelling with stressed syllables in capitals (`UN-guhr`) is no longer read as an initialism, and Kokoro's inline phoneme markup (`[Jordache](/ʒɔrdæʃ/)`) keeps its brackets and slashes.

## [0.8.1] — 2026-09-15

- The eighties persona seed is now a valley girl, Tiffani, in place of the bright video-age jock. She talks in uptalk, loves whatever the station plays because it is on the radio, and cannot understand the music nobody plays. A station that already has the old jock keeps him: seeds are only written to an empty station, and "Restore built-ins" adds missing ones without overwriting.

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

[Unreleased]: https://github.com/robert-dean/deadair/compare/v0.12.2...HEAD
[0.12.2]: https://github.com/robert-dean/deadair/compare/v0.12.1...v0.12.2
[0.12.1]: https://github.com/robert-dean/deadair/compare/v0.12.0...v0.12.1
[0.12.0]: https://github.com/robert-dean/deadair/compare/v0.11.1...v0.12.0
[0.11.1]: https://github.com/robert-dean/deadair/compare/v0.11.0...v0.11.1
[0.11.0]: https://github.com/robert-dean/deadair/compare/v0.10.0...v0.11.0
[0.10.0]: https://github.com/robert-dean/deadair/compare/v0.9.0...v0.10.0
[0.9.0]: https://github.com/robert-dean/deadair/compare/v0.8.3...v0.9.0
[0.8.3]: https://github.com/robert-dean/deadair/compare/v0.8.2...v0.8.3
[0.8.2]: https://github.com/robert-dean/deadair/compare/v0.8.1...v0.8.2
[0.8.1]: https://github.com/robert-dean/deadair/compare/v0.8.0...v0.8.1
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
