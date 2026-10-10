# Changelog

Notable changes to the Android listener, newest first. Its version is `versionName` in
`app/build.gradle.kts`, mirrored there from this directory's `package.json` by
`pnpm release:version`; entries are written from changesets naming `@deadair/android`. A version is
published to Google Play by the Android release workflow, from an `android-v<version>` tag or by
hand, and the station's own changes are in the [root changelog](../../CHANGELOG.md).

## [Unreleased]

## [0.15.6] — 2026-10-10

- Signed in, Now playing has a Lyrics button whenever the record you are hearing has words. It opens the lyrics with the line being sung lit and kept in view, timed to what you hear rather than to what the station has just sent, and shows the words as they came when the source has no timings. Signed out, or on an instrumental or a talk break, there is no button.

## [0.15.5] — 2026-10-10

- What's on: a block whose name or brief is cut short can be tapped to show the whole of it, and tapped again to fold it back.
- Now playing has a Request button for anybody signed in, so asking the station for a record no longer means going to Up next first. It sits at the end of the play controls, with the operator's heart moved from beside the title to the other end, and Request has a new icon everywhere it appears: a speech bubble with a note in it.

## [0.15.4] — 2026-10-10

- Now playing changes record when you hear it change. While the station was playing on your phone, the screen moved to the next record as soon as the station picked it, which could be several seconds before the music did and before the lock screen did, and its progress bar ran the same few seconds ahead and reached the end of a record that was still playing. The screen, the bar under it and the player bar on What's on now follow the audio you are hearing, as the lock screen and the widget already did. With the station stopped they show what the station is playing, as before.

## [0.15.3] — 2026-10-09

- The station picks up again much sooner when your phone moves between wifi and mobile data. On the Automatic format (HLS) the app used to carry on over the network it had just left, so walking out of the house meant around eighteen seconds of silence before it noticed, gave up and reconnected. It now reconnects over the new network as soon as the phone switches, with a second or two of buffering.

## [0.15.2] — 2026-10-09

- A password manager that holds your account's authenticator secret (1Password, Bitwarden, Google Password Manager) can now fill the code when signing in as an operator. The code box used to ask only for a code from a text message, so a password manager had nothing to offer there and the code had to be typed or pasted by hand.

## [0.15.1] — 2026-10-05

- What's on and Up next now show the presenter's picture. Each block in What's on has its host's portrait beside the line that names them, for the shows coming up as well as the one on now, and the top of Up next has the portrait of whoever is presenting beside their name. A host with no picture is shown by name alone, as before.

## [0.15.0] — 2026-10-05

- The presenter now has a face. When the operator has given a persona a picture, Now playing shows it as a small round portrait beside "with" and their name, and during a talk break the portrait takes the place of the radio glyph that used to stand in for a cover: on Now playing, in the player bar over the other tabs, on the lock screen and notification, and on the home-screen widget. A record's own cover always wins while a record plays. A persona with no picture, or a station that does not send one yet, looks exactly as before.

## [0.14.0] — 2026-10-04

- Signed in, you can now ask the station to play a record. Up next has a Request button: search by title or artist, pick a record, and add your name, a dedication or a message if you like. When the station holds few matches, records from its music providers are offered too, marked with where they come from, and the station fetches one before playing it. The station plays a request soon after it is asked for, between two records, if its rules allow, and it takes one request at a time from each listener. The same page lists your recent requests and what became of each one, including the station's reason when it turned one down.

## [0.13.0] — 2026-10-03

- A new format, Automatic, is now what the app plays unless you pick one: HLS where the station publishes it, so moving between wifi and mobile data does not cut the stream, and MP3 where it does not. If you never chose a format you are on Automatic after updating; if you chose one, you keep it. HLS sits a few seconds further behind live than MP3, and with the screen off the lock screen's title can take up to half a minute to change.
- Moving between wifi and mobile data no longer leaves the stream on the network it started on. An MP3, AAC, Opus or FLAC stream is reconnected over the new network the moment the phone switches, instead of going silent until the old connection times out, and a reconnect that was already waiting is made at once. HLS, which fetches each piece of audio afresh, is left as it is.
- A stream that drops while the phone has no network now waits for one instead of retrying against nothing. It used to give up and stop after five minutes, even when the signal came back seconds later; now it reconnects the moment a network is back, starting again from a short wait, and stops only after fifteen minutes without one.

## [0.12.0] — 2026-10-03

- Save a talk break as well as sharing it. Every row in "What it said" that has a share button now has a save button beside it, which fetches the same small copy and opens the system's save dialog, so the clip can be kept in Downloads, on Drive or wherever you pick, under a name you can change. It asks for no storage permission. Dismissing the dialog saves nothing and says nothing.

## [0.11.2] — 2026-10-02

- A playlist can be aired with similar records mixed in from the phone, as it can from the console. The playlist page has a "Mix in similar records" box beside "Take calls"; left unticked it says nothing, so a station with mixing switched on still mixes into every playlist.

## [0.11.1] — 2026-10-02

- Two of Google Play's release recommendations, answered. The app now ships a current AndroidX Fragment (1.9.1) rather than the 1.0.0 that Google's code scanner pulled in, and the code scanner no longer insists on portrait, so it turns with a tablet or a foldable like the rest of the app.

## [0.11.0] — 2026-10-02

- Copy what the station said. Every row in "What it said" that has words gets a copy button beside Share, which puts the script on the clipboard and shows a tick for a moment. It copies the words only, never the reason the station gives for a break it declined.

## [0.10.0] — 2026-10-02

- Share a talk break from "What it said". Every row whose break became audio has a share button, which asks the station for its small copy of that break (sized so a plain text message can carry it) and opens the share sheet with it, so it can go by SMS, a chat app or email. Signed-in listeners get it as well as the operator. The single-break page that Up next opens has the same button. The app keeps only the one copy it is sending, in its cache. A station older than this release sends the full-size original instead, which still shares but may be too big for a plain text message.

## [0.9.0] — 2026-09-25

- Up next is headed by the host's name, the one they go by on air, as What's on shows it. If you run the station, tap the name to change who presents the show; it has moved there from the Manage page.

## [0.8.0] — 2026-09-25

- If you run the station, Up next now has one Manage button in place of the host chip, Plan and the menu. It opens a page with everything in one place: who presents the show, replanning it, putting on one of your playlists, adding a record, and what the station has said. Asking the station to refill is gone (it refills by itself), and shuffling is on Now playing.
- Now playing has been redrawn. The cover starts under the status bar and fades into the page, the record's title and artist sit centred beneath it with who is presenting under them, the cover's colours drift behind the whole screen as a slow mesh while the station is on air, and a thin line shows how far through it the station is. The play button, its glow and the line take their colour from the cover, so they change with every record. The tabs slide away after a few seconds so the cover has the screen, any touch brings them back, and the cover shows through them. If you run the station, shuffle what is coming up and skip sit either side of play, and a heart beside the title likes the record on air.
- You can now scan your station's code instead of typing its address: the console shows it on the Checkup page, and "Scan your station's code" on the setup screen reads it and checks the station straight away. It uses Google Play services' scanner, so the app never asks for the camera; on a phone without Play services, type the address as before.
- If you run the station, you can now sign in straight from setup: once your station's address has answered, "I run this station: sign in" keeps the station and takes you to the sign-in page, then on to what is playing.
- Up next has been redrawn to match Now playing: a large heading over the colours of the record on air (and no player bar, since the record on air is in the list), rounded covers with each record's length beside it, and the record on air on a card of its own with a moving level meter. If you run the station, hold a record to rearrange the list, then drag records where you want them.
- The first time you open the app it now greets you with a welcome screen, the station's mark where the splash screen left it, before asking for your station's address. The address screen has been restyled to match. A `deadair://` link still goes straight to the address.
- The desk, where the station is taken off air or held against the schedule, is now in Settings under the station's address, rather than in Up next's menu.
- The sign-in page is laid out like the new address screen, with the same rounded fields.
- Opening the app now shows the station's mark on a splash screen until it knows where to take you, instead of a blank screen.

## [0.7.1] — 2026-09-25

- The app no longer freezes when the system's media controls, Android Auto or a Bluetooth head unit connects to it. The library root is now answered at once instead of after a settings read that could never finish while the connection held the main thread.
- Airing a playlist or a chart has a "take calls" row above its button, off unless ticked. With no station-wide setting any more, a show takes calls only when it is put on air with them.
- Planning a new show now shows who hosts it as a dropdown field, like the fields around it. It was a line of text that could be tapped but did not look it, so it was easy to miss that a new show can be given a host.

## [0.7.0] — 2026-09-20

- The station on the home screen. **Settings > Home-screen widget > Add to the home screen** asks your
  launcher to place one, or add it the usual way from the launcher's own widget list.

  It shows what is playing — the record's title over its artist, or who is on the mic while the station
  talks — with its cover, and a button that starts and stops the station without opening the app.
  Signed in as the station's operator, it also carries Skip: the first press arms it and says so, the
  second cuts the record, and it forgets on its own after five seconds, so a press in a pocket costs
  nobody a record.

  **Shows what is on** while this phone is playing (the default) or whenever the station is on air. The
  default asks the station nothing at all while you are not listening — no poll, no background work.
  Following the station instead checks every half hour and whenever you tap the time the widget shows,
  and it tells you how old that answer is once it is more than two minutes.

## [0.6.1] — 2026-09-20

- A stream the app has given up on now stops, instead of sitting there looking like it is still
  playing. It has always stopped trying to reconnect after five minutes, so a phone left on a station
  that went away does not flatten its battery against it — but it went on holding the notification
  with its Stop button, and went on asking the station what was on every three seconds, for a stream
  that had already been abandoned. The worst case was a station whose stream had dropped while the
  rest of it answered normally: the retries ended and the asking never did. Now it stops properly, and
  Play starts it again.

  Listening with the screen off costs less. While something is actually showing what is on — the app
  in front of you, or the lock screen with the display lit — nothing has changed: the station is asked
  every three seconds, as before. With the display dark, when nobody can see the answer, it drops to
  every thirty seconds. What keeps the lock screen right in between is the record itself: the title
  carried in the audio arrives exactly when the record changes, and the app asks the station then
  rather than on a clock, so the lock screen is if anything more accurate than it was. Measured on a
  phone over twenty minutes of listening with the screen off, this is about 18% less processor time
  and a tenth of the requests. It is not a dramatic saving and it is worth being plain about that:
  the audio stream itself is the great majority of what listening costs, and none of this changes it.

  Now playing also stops animating the progress bar once it has faded away to show the cover.

## [0.6.0] — 2026-09-20

- The station can be the phone's wallpaper. **Settings > Station wallpaper > Set as wallpaper** opens
  the system's own picker on it, where you choose the lock screen, the home screen or both, and
  choosing another wallpaper is how it comes off again. Nothing is ever written over the wallpaper you
  already had.

  Its settings are in the app and behind the picker's own Settings button. **Show the cover** while
  this phone is playing (the default, and the one that asks the station nothing while you are not
  listening) or whenever the station is on air. **With nothing to show** keep the last cover dimmed,
  draw the station's mark, or draw nothing. **Put the cover** at the top, in the middle (the default)
  or at the bottom, so it sits where your widgets and icons are not.

  **Color the phone from** the station's own colors (the default, and the one that never moves), the
  cover on screen, or a color you pick from a row of swatches, black and dark grey among them.
  Following the cover means your phone re-colors itself every time the station changes record, which
  is the point of choosing it.

  It runs only while it can be seen.

## [0.5.0] — 2026-09-19

- Now playing is the cover and nothing over it. The art runs to the top of the screen, the words sit at
  its foot, and under them are two round controls of the same size: **Stop**, which stops this phone
  (TalkBack now says "Stop listening"), and, for the station's operator, **Skip**. Left alone for a few
  seconds while a record plays, the words, the controls and the tabs fade away and the cover fills the
  screen; the first touch brings them back and does nothing else. It stays put while TalkBack is on.

  Everything that can take the station off air has moved to **The desk**, a page of its own reached
  from the Up next menu. It says whether the station is on air and who it is going out to, and holds
  **Skip**, **Take off air**, the hold, when the station goes on air, and why it is or is not on.
  **Take off air** asks for a second press and shows the five seconds it waits for one as a bar that
  drains across the button.

  Settings is the fourth tab, and the gear has left every screen. Signing in is a page of its own:
  every **Sign in** opens it over the screen that asked, and you come back to that screen once you are
  in. The sleep timer is there now, under
  Listening, while the station is playing. History is a page, reached from the top of Up next.

  The Up next bar keeps **What it said** and puts the operator's actions in one menu, each in words:
  The desk, Air something…, Add a record…, Ask the station to refill, and Shuffle what has not aired.

  The note under the play button about falling back to MP3 is gone, as is the listener count there;
  the desk shows the count to the operator.

## [0.4.0] — 2026-09-19

- The station's operator can add a record from the phone. **Add a record** on the Up next tab searches
  the library by title; **Play next** puts a record straight after what the station is already
  holding, and **Add to the end** puts it last. A record's own page offers the same two. Records the
  station has no audio for yet are listed but cannot be added, and a record the station declines
  (something you disliked, say) is refused with a sentence rather than a number.

  A Quick Settings tile turns the station on and off without opening the app. It shows **Warming
  up** for the seconds between pressing it and the first sound, and is greyed out until a station has
  been chosen.

  `deadair://` links open the app. A link names a station and fills in the setup screen with it;
  nothing changes until you check the address and choose to listen, and **Keep the station I have**
  turns it down. The station's check-up page in the console has one, and a code to scan with the
  phone.

## [0.3.0] — 2026-09-17

- The running order shows the picture a break wears. A weather forecast and a news bulletin already
  had one on the stream and in a listener's player; the order at the desk and on the phone drew a
  microphone against every break, so the same forecast looked like two different things depending on
  where you were standing. Both now draw the picture, and the microphone is what a kind with no
  picture falls back to.

## [0.2.1] — 2026-09-16

- The persona flag that says who the station's own host is has been renamed from `active` to `defaultHost`, everywhere: the `personas.default_host` column (migration 0031, applied at boot), the `Persona` contract and all four SDKs, and `PUT /personas/{id}/active`, which is now `PUT /personas/{id}/default-host`. Nothing about who presents changes; the old name said "on air", which it never meant during a broadcast that named its own host, and the console badged the wrong character for exactly that reason. The Personas page button now reads **Make station host** rather than "Put on air", and the desk's persona pickers mark whoever is actually presenting. The operator desk on macOS follows the same rename, and its Voice page lamp now marks the character presenting rather than the station's own host.

## [0.2.0] — 2026-09-13

- Android Auto: the app is listed among the car's media apps, with the station in it. Tap it, or ask the car's assistant to play it, and the station starts, on the format chosen in Settings. The car's controls behave as a headset's do: stop drops the stream, and the next button is only there for the station's operator.
- A "Play when the app opens" switch in Settings, off by default. With it on, opening the app starts the station, unless it is already playing. Turning the phone sideways or coming back from Settings does not start it again, and the first seconds are quiet while the station comes on air.
- A player bar sits above the tabs on Up next, Played and What's on, with the cover, what is on and the play or stop button, so the station can be stopped without going back to Now playing. Tapping the bar's words opens Now playing. It is not shown on Now playing itself, which already has the button.
- Now playing names the show and who presents it, on a line above the record ("Late Static · with Cass"). While the station talks between records, the title says the host is on the mic and the break's own label goes underneath, where the artist would be; the lock screen, the notification and a car's display say the same instead of a title over nothing. It needs a station new enough to say what is on, and against an older one the screen looks exactly as it did.
- A sleep timer: while the station is playing, the moon under the play button stops it after 15, 30, 45 or 60 minutes, or at the end of the record that is on. The sound fades out over the last ten seconds, and the next press of play is at full volume. "After this record" waits for the end you actually hear, a few seconds after the station's own. The countdown shows beside the moon, and stopping by hand turns the timer off.

## [0.1.1] — 2026-09-11

- The privacy policy is one tap away, at the foot of Settings and on the first screen before a station is named.

## [0.1.0] — 2026-09-09

- The first public release. Listen to your own deadair station in the background, from the lock
  screen, a headset or a car stereo. Sign in as the station's operator and the phone becomes its
  remote: skip, stop and start, the running order, what it played and what the presenter said.

[Unreleased]: https://github.com/robert-dean/deadair/compare/android-v0.15.6...HEAD
[0.15.6]: https://github.com/robert-dean/deadair/compare/android-v0.15.5...android-v0.15.6
[0.15.5]: https://github.com/robert-dean/deadair/compare/android-v0.15.4...android-v0.15.5
[0.15.4]: https://github.com/robert-dean/deadair/compare/android-v0.15.3...android-v0.15.4
[0.15.3]: https://github.com/robert-dean/deadair/compare/android-v0.15.2...android-v0.15.3
[0.15.2]: https://github.com/robert-dean/deadair/compare/android-v0.15.1...android-v0.15.2
[0.15.1]: https://github.com/robert-dean/deadair/compare/android-v0.15.0...android-v0.15.1
[0.15.0]: https://github.com/robert-dean/deadair/compare/android-v0.14.0...android-v0.15.0
[0.14.0]: https://github.com/robert-dean/deadair/compare/android-v0.13.0...android-v0.14.0
[0.13.0]: https://github.com/robert-dean/deadair/compare/android-v0.12.0...android-v0.13.0
[0.12.0]: https://github.com/robert-dean/deadair/compare/android-v0.11.2...android-v0.12.0
[0.11.2]: https://github.com/robert-dean/deadair/compare/android-v0.11.1...android-v0.11.2
[0.11.1]: https://github.com/robert-dean/deadair/compare/android-v0.11.0...android-v0.11.1
[0.11.0]: https://github.com/robert-dean/deadair/compare/android-v0.10.0...android-v0.11.0
[0.10.0]: https://github.com/robert-dean/deadair/compare/android-v0.9.0...android-v0.10.0
[0.9.0]: https://github.com/robert-dean/deadair/compare/android-v0.8.0...android-v0.9.0
[0.8.0]: https://github.com/robert-dean/deadair/compare/android-v0.7.1...android-v0.8.0
[0.7.1]: https://github.com/robert-dean/deadair/compare/android-v0.7.0...android-v0.7.1
[0.7.0]: https://github.com/robert-dean/deadair/compare/android-v0.6.1...android-v0.7.0
[0.6.1]: https://github.com/robert-dean/deadair/compare/android-v0.6.0...android-v0.6.1
[0.6.0]: https://github.com/robert-dean/deadair/compare/android-v0.5.0...android-v0.6.0
[0.5.0]: https://github.com/robert-dean/deadair/compare/android-v0.4.0...android-v0.5.0
[0.4.0]: https://github.com/robert-dean/deadair/compare/android-v0.3.0...android-v0.4.0
[0.3.0]: https://github.com/robert-dean/deadair/compare/android-v0.2.1...android-v0.3.0
[0.2.1]: https://github.com/robert-dean/deadair/compare/android-v0.2.0...android-v0.2.1
[0.2.0]: https://github.com/robert-dean/deadair/compare/android-v0.1.1...android-v0.2.0
[0.1.1]: https://github.com/robert-dean/deadair/compare/android-v0.1.0...android-v0.1.1
[0.1.0]: https://github.com/robert-dean/deadair/releases/tag/android-v0.1.0
