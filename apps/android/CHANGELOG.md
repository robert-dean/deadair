# Changelog

Notable changes to the Android listener, newest first. Its version is `versionName` in
`app/build.gradle.kts`, mirrored there from this directory's `package.json` by
`pnpm release:version`; entries are written from changesets naming `@deadair/android`. A version is
published to Google Play by the Android release workflow, from an `android-v<version>` tag or by
hand, and the station's own changes are in the [root changelog](../../CHANGELOG.md).

## [Unreleased]

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

[Unreleased]: https://github.com/robert-dean/deadair/compare/android-v0.2.0...HEAD
[0.2.0]: https://github.com/robert-dean/deadair/compare/android-v0.1.1...android-v0.2.0
[0.1.1]: https://github.com/robert-dean/deadair/compare/android-v0.1.0...android-v0.1.1
[0.1.0]: https://github.com/robert-dean/deadair/releases/tag/android-v0.1.0
