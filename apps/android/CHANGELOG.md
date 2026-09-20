# Changelog

Notable changes to the Android listener, newest first. Its version is `versionName` in
`app/build.gradle.kts`, mirrored there from this directory's `package.json` by
`pnpm release:version`; entries are written from changesets naming `@deadair/android`. A version is
published to Google Play by the Android release workflow, from an `android-v<version>` tag or by
hand, and the station's own changes are in the [root changelog](../../CHANGELOG.md).

## [Unreleased]

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

[Unreleased]: https://github.com/robert-dean/deadair/compare/android-v0.7.0...HEAD
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
