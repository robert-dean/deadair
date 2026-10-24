# Changelog

Notable changes to the desktop listener and operator desk, newest first. Its version is `<Version>`
in `Directory.Build.props`, mirrored there from this directory's `package.json` by
`pnpm release:version`; entries are written from changesets naming `@deadair/desktop`. A release is
the Desktop release workflow, run by hand, which tags `desktop-v<version>`. The station's own
changes are in the [root changelog](../../CHANGELOG.md).

## [Unreleased]

## [0.17.2] — 2026-10-24

- Saving a slot from the desk's Timetable no longer resets the settings the editor does not draw. Whether the host talks, whether chart positions are read out, a request show and how many records follow each request, and the slot's own repeat window, artist cooldown and per-artist cap are now sent back exactly as the station holds them.

## [0.17.1] — 2026-10-24

- Saving a slot from the Timetable keeps which writer it asks first for its breaks, which is set on the web console.

## [0.17.0] — 2026-10-23

- A record, a release or an artist can be suspended from its page in the console: **Suspend** for a day, a week or a month keeps it off the station without touching your rating, the page says how long is left, and **Lift** ends it early. The tracks list counts and filters what is suspended and marks a suspended row, and the desktop app's record list has the same filter. On the API, `TrackState` gains `suspended` and the state counts carry `suspended`.

## [0.16.1] — 2026-10-21

- Skip in the window now names the record it is showing. If it finished in the moment before the press reached the station, nothing is skipped and the station's own sentence says so: "That had already finished, so nothing was skipped." Before, the press cut the record that had just started. The media key still skips whatever is on.

## [0.16.0] — 2026-10-19

- A persona can now be set to always work one fact about the music into every link ("How much they lean on what the station knows" → Always). The station picks the fact, preferring a sourced one about the record coming up, and the presenter says it in their own words beside their usual patter.
- A persona can now be set to never be handed what the station knows about the records ("How much they lean on what the station knows" → Never). Its links are written from the records alone, and the facts it is not shown stay unused for whoever presents next.
- A persona can now be set to work one fact about the music into a link now and then ("How much they lean on what the station knows" → Sometimes): about a third of its links carry one, chosen by the station, and the rest carry none.
- A character whose sheet carries a dial setting this build does not know (one the station added after the app was built) now opens, with that dial showing the station's usual, rather than failing to load.

## [0.15.0] — 2026-10-19

- Signing in answers an emailed code as well as an authenticator code. An account whose second factor is email (with or without a passkey beside it) is sent a code and can ask for it again, instead of being told to sign in on the web console, and an account with both an authenticator and email can choose "Email me a code instead". A passkey or phone factor alone is still refused, with words that no longer suggest email is the problem.

## [0.14.1] — 2026-10-19

- "Forgot your password?" with an address the station cannot read as one now says "That is not an email address. Check what you typed." It used to say the station could not be reached, which sent somebody to check their network instead of their spelling.

## [0.14.0] — 2026-10-17

- Sign-in has "Forgot your password?": it asks the station to email a link to the address typed, which opens the station in a browser to choose a new password, and the panel then says to check that inbox. With no address typed it asks for one first. A station that has sent that address enough links, or cannot send email at all, is said plainly.

## [0.13.3] — 2026-10-14

- Characters who do several jobs are handled whole. The host pickers offer only characters who can present, so a guest or the newsreader is no longer offered and refused; the roster lists the newsreader and guests under headings of their own; a character's ties read "Drops by" for somebody who drops by rather than rings in; and saving a character keeps every job it has, so a host who also drops by stays one.

## [0.13.2] — 2026-10-14

- A schedule block that plays a playlist can pick it up where it left off. Switch on **Pick the playlist up where it left off** in the slot editor, and each time the block opens it starts with the record after the last one from its playlist that aired, rather than from the top, so a long playlist on a short block gets all the way through over several nights. An operator's takeover ending in the middle of the block no longer starts the playlist over. The editor shows the record the block will open on next, and **Start from the top** sends it back to the beginning; a record taken off the playlist, or choosing a different playlist, starts it from the top too. Through the API it is `resumePlaylist` on a slot, with `GET` and `DELETE /schedule/{id}/playlist-position`. The desktop app keeps the setting when it saves a slot.

## [0.13.1] — 2026-10-14

- A schedule slot, and a broadcast put on air by hand, can name moods to steer away from with `avoidMoods`. A record a model judged to be in one is half as likely to be picked for the whole of the slot, and never kept off the air for it: the judgement is right about half the time, so refusing a record outright stays a never-play rule's job. The console's slot editor sets them under **Steers away from**, and the desktop app keeps a slot's avoided moods when it saves the slot.
- A value a newer station sends that this version of the app does not know, such as a new kind of activity or a new reason the station is quiet, no longer stops a screen from loading. The app shows it as unknown, or leaves it out where nothing sensible can be said, and carries on.

## [0.13.0] — 2026-10-12

- A production can be handed sources to read: pasted text, each with a title. Given sources and no notes, the station reads them before writing anything and keeps as notes only the claims whose words it can find in them, so a podcast made from an article states nothing as fact that the article does not say. One whose sources give nothing usable fails with the reason rather than being written from general knowledge. Productions have a new state, `researching`, while their sources are being read; the console and the desktop app call it "reading its sources", and it can be stopped like any other stage. The console's production form has a Sources section. In the API, `ProductionRequest` and `Production` carry an optional `sources` list, and a source with no text is refused.

## [0.12.0] — 2026-10-12

- The operator can ask the station to say something from the desk. A Say something button beside Take a call offers the news, the weather, or a word from the host. Each is heard after the current record, once it has been written. The answer is shown at the foot of the page: in the ordinary colour when it is on its way, or with the station's reason when it is turned down (breaks are off, or the same request went in a moment ago). Neither is drawn as an error any more.

## [0.11.0] — 2026-10-11

- Importing a persona file no longer replaces a character you already have. A character in the file whose key matches one on this station is now skipped by default, and the import dialog in the console and the desktop app says so and offers Replace on that row. In the API, `POST /personas/import` and `/personas/import/preview` take an optional `replace` list of keys to rewrite, a plan entry's `outcome` can be `skip`, and the result counts `skipped`. A caller that relied on an import overwriting a matching character now has to name it in `replace`.

## [0.10.0] — 2026-10-11

- A persona's quirks are rows now, each with how often it applies: Always, Often, Occasionally or Rarely. Every existing quirk is Always, so nothing a station says changes yet. In the API a quirk is `{ text, cadence }` rather than a string, and persona files are `deadair.persona/2`; the console still imports a `/1` file, upgrading its quirks as it reads it.
- The playlist import's link field now names every source a link can come from: Spotify, YouTube Music, Apple Music, Pandora, Navidrome, Jellyfin, Emby and Plex. The lyrics source setting no longer says the words are never shown, since the listener apps and the record page show them.

## [0.9.0] — 2026-10-11

- When a record's lyrics time each word, the Now playing panel and Studio light the words as they are sung: the sung part of the current line turns the accent colour with a soft glow. Lines timed only as lines are lit whole as before. While such words are showing, the playhead moves ten times a second rather than twice.
- The Now playing panel shows the words of the record you are hearing, when the station has them and you are signed in. Timed lyrics light the line being sung and scroll to keep it in view, following the audio rather than the station's clock; lyrics without timings are shown whole. The Lyrics heading folds the section away.
- Studio can show the words in place of the cover. When the record has lyrics, a button beside play swaps the cover for a large column of them, the line being sung lit and kept in view, and pressing it again brings the cover back. The button fades with Studio's other controls, and the cover returns by itself whenever there are no words to show.
- While the station is playing on a speaker rather than this Mac, a strip across the top of the window says which one ("Playing on Kitchen"), so it can be read from across the room. Clicking it opens the output picker. A speaker that did not answer the last look is still named, and the strip says it is not on the network; nothing moves the sound on its own.

## [0.8.0] — 2026-10-11

- Studio can keep the display awake. A new setting on the Settings page, Keep the display awake, has three answers: Never (the default), While charging and Always. The display stays awake only while Studio is up where it can be seen and the station is playing, and goes back to sleeping as usual the moment you leave Studio, stop or quit.
- The history view no longer tells an operator to turn on `llm.captureWrites` when a prompt was not kept. It names the setting the way the console shows it, "Keep the prompt and the raw answer" under Words in Settings.
- VoiceOver names every button that shows only an icon. Moving and dropping records in the running order, the rating thumbs, the sort direction on Acts, Albums and Records, a playlist's menu, Back on setup, showing the password, dismissing a refusal and signing out each said "button" and nothing more, and now say what they do. The running order's move up, move down and drop buttons also gain the tooltips they were missing, and the progress bars and sliders elsewhere in the app are named too.
- VoiceOver names the player bar's and Studio's controls. Play and Stop, Skip, Shuffle, the speaker picker, Now playing, Studio, Open the desk, Leave Studio and Back were each read out as "button" and nothing more, and the volume slider and the progress bar under the record had no name at all. Each one now says what it does, in the same words as its tooltip.

## [0.7.3] — 2026-10-10

- The progress bar now follows the record whose title it is drawn under. For a few seconds after every record change it was counting down the next record while the previous one's title was still showing, and the rest of the time it ran a few seconds ahead of what you could hear, reaching the end while the music was still playing. The bar and the position in the system's Now Playing now follow the audio, as the title already did.

## [0.7.2] — 2026-10-09

- A schedule slot can have co-hosts who present beside its host (`coHosts`): every night, on fixed nights, or as a visitor who turns up at random (`everyN`, with `cooldownDays` between visits), like a guest host. Up to three are on air on any one night. The running order and `GET /schedule/current` say who is co-presenting tonight, and a visiting co-host's night begins at the top of the show. On a show with co-hosts, talk breaks go round them: each one is written and spoken by whichever presenter was heard least recently, and every break knows who else is presenting tonight. A **banter** is a new kind of production for a show with co-hosts: the presenters trade lines for a few minutes, the lead bringing the others in and handing back to the music at the end. Put a `banter` band on the format clock to have a few a show; one asked for on a show with nobody beside the host fails with a reason. In the console, the slot editor has Co-hosts under Guest hosts (every night, on these nights, or visiting), and Today names tonight's co-hosts beside the host. The desktop editor carries a slot's co-hosts through untouched.
- A schedule slot can have guest hosts who sit in for its own host on some nights (`guestHosts`). A guest is on fixed nights (`days`), or at random: `everyN` is about one of the slot's nights in that many, and `cooldownDays` is the fewest days between two of their nights (half of `everyN` when unset, so an about-weekly guest never lands two nights running). The random nights are worked out from the date, so the console, the timetable and the station all agree on who is on a given night, and nothing re-rolls mid-show. A guest has to be a host. On a guest's night the station puts them on and remembers whose show it usually is. The guest's breaks know they are sitting in for the regular presenter, by name and on which show, so they can say so and never call the show theirs.

  In the console, the slot editor has Guest hosts: who sits in, then either the nights they sit in or about how often at random, with the gap between visits. Today names tonight's guest as sitting in for the regular host. `GET /schedule/current` says who presents the block on now (`hostPersonaId`) and whose show it usually is (`regularPersonaId`). The desktop editor carries a slot's guest hosts through untouched.

## [0.7.1] — 2026-10-09

- The schedule can hold special shows on dates: Halloween night, the week before Christmas, a one-off evening. A slot with a first and last date (`startsOn`, `endsOn`) is a special, and `yearly` repeats it on the same month and day every year, including a range that runs past New Year. On its dates a special takes over from the weekly schedule for its hours, and the weekly show resumes when it ends. Two specials still may not overlap each other.

  In the console, Programme has a Specials tab listing every special (on today first, then the soonest, then the ones that are over) with New special to add one; the slot editor takes a date range and a "Repeats every year" switch for a special. The timetable draws a special on its dates, named as one, with the weekly blocks trimmed around it, and refuses to drag one to another day. Dragging a block on the timetable no longer clears its mood, and paging the timetable to another week works again (it answered Bad Request).

  The desktop app's timetable says a special's dates instead of its days, and editing any slot there no longer clears its mood or a special's dates.

## [0.7.0] — 2026-10-05

- When the station has a picture of whoever is presenting, the app shows it beside their name on the desk, in the Now playing panel and in Studio. During a break, which has no cover of its own, the presenter's picture takes the cover's place, and the page's colours follow it. A presenter with no picture, or a station that does not send one, looks exactly as before.

## [0.6.0] — 2026-10-04

- Studio: the record on air across the whole window, to sit back from. It takes the screen, and leaving puts the window back as it was. The cover large, the title, who is presenting and the playhead, over the cover's own colours drifting slowly, with Listen and Stop and nothing else. Open it with the TV button in the bar, Window › Studio, or F; leave it with Escape, F or its close button. The controls and the pointer fade after a few seconds of stillness, the backdrop holds still if Reduce Motion is on, and it stops drawing while the window cannot be seen. Space still starts and stops the station, and the bar's play button now says so.
- The desk and the Now playing panel now say who is presenting: "with Cass" under a record, and "Cass is on the mic" during a break, in the Android app's words. A break no longer leaves a blank line where its artist would be.

## [0.5.0] — 2026-10-03

- The Auditions tab can put a character through the station's own playlists and through charts, as well as a provider's playlist. The picker offers the same sources as the timetable, each with its kind beside it, and a run's line says which kind it came from.

## [0.4.1] — 2026-10-02

- A new plugin capability, `transcode`, makes a small copy of a piece of audio for somebody to send on rather than for the station to air. The bundled audio analyzer answers it through a new `/transcode` endpoint on the analysis sidecar, which encodes with ffmpeg's own AAC encoder (mono at 64 kbps by default, so a minute of speech is about half a megabyte). It has its own provider choice, "Make copies to share with" (`render.transcodePluginId`), so a station can join audio with one plugin and make copies with another; leave it empty and the first plugin that can is used, as for every other provider. Nothing asks for a copy yet. The console and the desktop app name the new capability on plugin cards and in Providers.

## [0.4.0] — 2026-09-29

- Check-up is tabbed: the machinery with the disk and the build, the activity feed a page at a time, what each decision cost, the station's logs (read and saved), and what is new in each release.
- The desk now says who is driving the station, holds it against the schedule or hands it back, changes its air mode and host, plans a new show, takes a call, skips to a record in the running order, rates the record on air, and lists what the station says needs the operator, with a count on each sidebar row it concerns.
- The library rates and repairs records, opens any act, release or record on a page of its own, imports, plays, renames, fills, exports and deletes playlists, reads a chart before it airs, narrows the news, and follows the station's podcasts and readings.
- Programme has the web console's four tabs: Today, with the format clock and its bands; a Timetable whose slots are added, edited and deleted through a dialog; Sustaining; and listener Requests to grant or decline.
- Settings is a list of sections, each saving on its own: every group of the station's settings, artwork, storage, providers and plugin requests, the station's plugins (configured, connected and removed), sign-in and security with a step-up that asks for a code, and the console's language packs.
- Anything that deletes or changes what airs asks first, what the station refused is said at the foot of every page, previews play over the station, and Command-K jumps to any page, tab, record, act or character.
- Voice has all ten of the web console's tabs: characters edited on a page of their own with their notebook, stories, memory and rehearsal, auditions, voices you can hear, segments, pronunciations, the soundboard, phrasings, subjects, productions, and what the station said.

## [0.3.0] — 2026-09-28

- An operator has Shuffle and Skip either side of the play button in the bar at the bottom, as the Android app does, so both are a click away from every page rather than only the desk.
- The running order shows each record's cover where the coloured dot was, and the station's note about why it is quiet wraps inside its card rather than running off the edge. The desk no longer has its own Skip, Stop, Start, Shuffle and Extend now buttons: Shuffle and Skip are beside the play button in the bar, and stopping or starting the station is done from the web console.
- The app takes the shape of a web music player. The sidebar, the page and a new Now playing panel are rounded panels on a black window. The page is washed in the colours of the record on air. The player bar centres its controls above the playhead. The Now playing panel shows the cover large, then what is coming up (for the operator) or what just played. It can be put away from the bar, and it steps aside on its own when the window is narrow. Covers stay square, and the station's green stays.
- A first run opens on a welcome with the station's mark and a Find your station button, as the Android app does. The address is checked before anything is kept: once the station answers, the button names it (Listen to your station's name), and I run this station: sign in keeps it and asks for the operator's sign-in on the next step, where Not now, just listen leaves you listening. Sign in in the sidebar now opens that same full-window page rather than a small panel.
- The record on air shows again. A new record is held back a few seconds so its title does not run ahead of the audio, and every poll of the station restarted that wait, so on a station that kept answering the record was never shown at all.

## [0.2.4] — 2026-09-22

- Settings keeps opening against a station that has split Rotation into Rotation, Breaks and Bulletins,
  and moved the station's phrasings to a group of their own. An older build cannot read the new group
  names and shows no settings at all until it is updated.

## [0.2.3] — 2026-09-16

- The persona flag that says who the station's own host is has been renamed from `active` to `defaultHost`, everywhere: the `personas.default_host` column (migration 0031, applied at boot), the `Persona` contract and all four SDKs, and `PUT /personas/{id}/active`, which is now `PUT /personas/{id}/default-host`. Nothing about who presents changes; the old name said "on air", which it never meant during a broadcast that named its own host, and the console badged the wrong character for exactly that reason. The Personas page button now reads **Make station host** rather than "Put on air", and the desk's persona pickers mark whoever is actually presenting. The operator desk on macOS follows the same rename, and its Voice page lamp now marks the character presenting rather than the station's own host.

## [0.2.2] — 2026-09-14

- The Settings and Controls menus and the menu-bar icon stay out of the way until a station has been connected. There was nothing for any of them to do on a first run.
- Text fields look like the Mac's own: a hairline border, no change on hover, and a soft focus ring rather than a thick coloured edge.
- Pressing Return in the station address box connects, without reaching for the Connect button.
- The first-run screen shows the station's mark above the wordmark instead of the word alone.

## [0.2.1] — 2026-09-14

- The app runs under macOS's hardened runtime, the first step towards a notarised download that opens without a warning. Nothing about opening it changes yet: it is still signed ad hoc.

## [0.2.0] — 2026-09-13

- The app can be pointed at a different station from Settings, with Change station, without restarting. Listening stops only once the new station answers, and a sign-in is kept for each station.
- Closing the window no longer stops the station: the app keeps playing, the Dock icon brings the window back, and Quit is what stops it.
- Space starts and stops listening, and the menu bar has a Controls menu (Listen or Stop, and Skip for the operator) and a Window menu with Minimize and Close.
- A deadair:// link opens the app on the station it names. If the app is already on a different station, it shows the new address and switches only when you press Connect.
- The app keeps a log at `~/Library/Logs/deadair/deadair.log`, and Settings has a button to show it in Finder, so there is something to attach when reporting a problem.
- A menu-bar icon shows what is on air and offers Listen or Stop, Skip for the operator, Show and Quit, so the station can be controlled with the window closed.
- A sleep timer on the Settings page stops listening after 15, 30, 45, 60 or 90 minutes, which also lets the station know you have gone.
- At launch the app asks GitHub once whether there is a newer desktop release and, if there is, offers a link to it in the sidebar. Settings has a switch to turn it off, and shows which version you are running.
- The window opens where you left it, as long as that is still on a connected screen.
- The app is signed (ad hoc, not yet notarised), and the release notes now say how macOS 15 and later open it: Open Anyway in System Settings › Privacy & Security, since right-click and Open no longer works.
- Quitting the app now stops a network speaker it was playing to. Before, a quit from the menu or ⌘Q ended the app before it could ask the speaker to stop.
- A settings file the app cannot read is left alone rather than overwritten with defaults, so a hand edit or a downgrade no longer loses your station address and speaker settings. The setup screen and Settings say which file it is.

## [0.1.0] — 2026-09-09

- The desktop listener and operator desk, for macOS on Apple Silicon. Point it at your station's
  address on first run. Listening needs no account; the desk appears when you sign in as the
  operator.

[Unreleased]: https://github.com/robert-dean/deadair/compare/desktop-v0.17.2...HEAD
[0.17.2]: https://github.com/robert-dean/deadair/compare/desktop-v0.17.1...desktop-v0.17.2
[0.17.1]: https://github.com/robert-dean/deadair/compare/desktop-v0.17.0...desktop-v0.17.1
[0.17.0]: https://github.com/robert-dean/deadair/compare/desktop-v0.16.1...desktop-v0.17.0
[0.16.1]: https://github.com/robert-dean/deadair/compare/desktop-v0.16.0...desktop-v0.16.1
[0.16.0]: https://github.com/robert-dean/deadair/compare/desktop-v0.15.0...desktop-v0.16.0
[0.15.0]: https://github.com/robert-dean/deadair/compare/desktop-v0.14.1...desktop-v0.15.0
[0.14.1]: https://github.com/robert-dean/deadair/compare/desktop-v0.14.0...desktop-v0.14.1
[0.14.0]: https://github.com/robert-dean/deadair/compare/desktop-v0.13.3...desktop-v0.14.0
[0.13.3]: https://github.com/robert-dean/deadair/compare/desktop-v0.13.2...desktop-v0.13.3
[0.13.2]: https://github.com/robert-dean/deadair/compare/desktop-v0.13.1...desktop-v0.13.2
[0.13.1]: https://github.com/robert-dean/deadair/compare/desktop-v0.13.0...desktop-v0.13.1
[0.13.0]: https://github.com/robert-dean/deadair/compare/desktop-v0.12.0...desktop-v0.13.0
[0.12.0]: https://github.com/robert-dean/deadair/compare/desktop-v0.11.0...desktop-v0.12.0
[0.11.0]: https://github.com/robert-dean/deadair/compare/desktop-v0.10.0...desktop-v0.11.0
[0.10.0]: https://github.com/robert-dean/deadair/compare/desktop-v0.9.0...desktop-v0.10.0
[0.9.0]: https://github.com/robert-dean/deadair/compare/desktop-v0.8.0...desktop-v0.9.0
[0.8.0]: https://github.com/robert-dean/deadair/compare/desktop-v0.7.3...desktop-v0.8.0
[0.7.3]: https://github.com/robert-dean/deadair/compare/desktop-v0.7.2...desktop-v0.7.3
[0.7.2]: https://github.com/robert-dean/deadair/compare/desktop-v0.7.1...desktop-v0.7.2
[0.7.1]: https://github.com/robert-dean/deadair/compare/desktop-v0.7.0...desktop-v0.7.1
[0.7.0]: https://github.com/robert-dean/deadair/compare/desktop-v0.6.0...desktop-v0.7.0
[0.6.0]: https://github.com/robert-dean/deadair/compare/desktop-v0.5.0...desktop-v0.6.0
[0.5.0]: https://github.com/robert-dean/deadair/compare/desktop-v0.4.1...desktop-v0.5.0
[0.4.1]: https://github.com/robert-dean/deadair/compare/desktop-v0.4.0...desktop-v0.4.1
[0.4.0]: https://github.com/robert-dean/deadair/compare/desktop-v0.3.0...desktop-v0.4.0
[0.3.0]: https://github.com/robert-dean/deadair/compare/desktop-v0.2.4...desktop-v0.3.0
[0.2.4]: https://github.com/robert-dean/deadair/compare/desktop-v0.2.3...desktop-v0.2.4
[0.2.3]: https://github.com/robert-dean/deadair/compare/desktop-v0.2.2...desktop-v0.2.3
[0.2.2]: https://github.com/robert-dean/deadair/compare/desktop-v0.2.1...desktop-v0.2.2
[0.2.1]: https://github.com/robert-dean/deadair/compare/desktop-v0.2.0...desktop-v0.2.1
[0.2.0]: https://github.com/robert-dean/deadair/compare/desktop-v0.1.0...desktop-v0.2.0
[0.1.0]: https://github.com/robert-dean/deadair/releases/tag/desktop-v0.1.0
