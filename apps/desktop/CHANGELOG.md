# Changelog

Notable changes to the desktop listener and operator desk, newest first. Its version is `<Version>`
in `Directory.Build.props`, mirrored there from this directory's `package.json` by
`pnpm release:version`; entries are written from changesets naming `@deadair/desktop`. A release is
the Desktop release workflow, run by hand, which tags `desktop-v<version>`. The station's own
changes are in the [root changelog](../../CHANGELOG.md).

## [Unreleased]

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

[Unreleased]: https://github.com/robert-dean/deadair/compare/desktop-v0.6.0...HEAD
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
