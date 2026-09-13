# Changelog

Notable changes to the iOS listener, newest first. Its version is `MARKETING_VERSION` in
`Config/Version.xcconfig`, mirrored there from this directory's `package.json` by
`pnpm release:version`; entries are written from changesets naming `@deadair/ios`. A version is
uploaded to TestFlight by the iOS release workflow, from an `ios-v<version>` tag or by hand, and the
station's own changes are in the [root changelog](../../CHANGELOG.md).

## [Unreleased]

## [0.2.0] — 2026-09-13

- A "Play when the app opens" switch in Settings, off by default. With it on, opening the app starts the station. Coming back to the app, or finishing setting up a new station, does not start it, and the first seconds are quiet while the station comes on air.
- Signed in, Now playing gains a Played button: what the station has played, newest first, with each record's cover and when it aired, and older pages as you scroll. It refreshes while it is open and asks the station nothing once it is closed.
- A player bar sits along the bottom of Settings, with the cover, what is on and the play or stop button, so the station can be stopped without going back to Now playing.
- Now playing names the show and who presents it, on a line above the record ("Late Static · with Cass"). While the station talks between records, the title says the host is on the mic and the break's own label goes underneath, where the artist would be; the lock screen and Control Center say the same instead of a title over nothing. It needs a station new enough to say what is on, and against an older one the screen looks exactly as it did.
- A sleep timer: while the station is playing, the moon under the play button stops it after 15, 30, 45 or 60 minutes, or at the end of the record that is on. The sound fades out over the last ten seconds, and the next press of play is at full volume. "After this record" waits for the end you actually hear, a few seconds after the station's own. The countdown shows beside the moon, and stopping by hand turns the timer off.
- Signed in, Now playing gains a What's on button: the block on now with how far through it is and who presents it, what is up next and after that, or how long the station has between blocks. If somebody has put something else on by hand, the block says "Due now" rather than "On air".
