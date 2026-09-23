# Changelog

Notable changes to the Stream Deck plugin, newest first. Its version is `package.json`'s, mirrored
into the plugin manifest's four-part `Version` by `pnpm release:version`; entries are written from
changesets naming `@deadair/streamdeck`. A release cuts itself on the push to main that moves that
version (the merge of the version pull request), tagged `streamdeck-v<version>`. The station's own changes are in the
[root changelog](../../CHANGELOG.md).

## [Unreleased]

## [0.2.3] — 2026-09-23

- Settings, Security and Settings, Sign-in and connections are one section now, Sign-in and security. Your own sign-in comes first: your authenticators and linked sign-ins, your API keys and the apps you have connected. Below that is what the station offers everybody: identity providers, who may join through one, whether apps may connect, and the apps registered with it. Setting up a provider and linking your own account to it no longer means two pages. An old link to Sign-in and connections opens the new section. The Stream Deck plugin points you to the new name when it asks for an API key.

## [0.2.2] — 2026-09-22

- The deadair heading in the Stream Deck app's action list now shows the station's own skull in headphones, in white, instead of a plain pair of headphones.

## [0.2.1] — 2026-09-22

- The plugin asks the station what is on air every five seconds instead of every two, and once more just after the record on air is due to end, so a new record now shows on the Now Playing key within a second of starting. That is 60% fewer requests from a deck left on all day. A Now Playing key with the progress bar turned off also no longer runs the half-second clock that moves the bar.

## [0.2.0] — 2026-09-17

- Like and Dislike: two new keys that set what the station thinks of the record on air, the same opinion you would set from the running order in the console. A like plays that record more often and a dislike means never again. Both draw the station's own skull on a heart, and the heart fills with colour when the station already agrees; pressing the lit one takes the opinion back. Both need an API key issued with Read and manage; a Read-only key still shows you what the station thinks.

## [0.1.0] — 2026-09-15

- The first release: a Now Playing key with the cover and a moving playhead, Skip, and a Stop key that asks for a second press before it takes the station off air and becomes Start once it has.
- Each Now Playing key can leave out the progress bar, or the title and artist, from its own settings.
- With no cover to show, the Now Playing key shows the deadair mark, faint while the station is stopped or not answering. When the station stops answering, the last cover stays on the key, faint.

[Unreleased]: https://github.com/robert-dean/deadair/compare/streamdeck-v0.2.3...HEAD
[0.2.3]: https://github.com/robert-dean/deadair/compare/streamdeck-v0.2.2...streamdeck-v0.2.3
[0.2.2]: https://github.com/robert-dean/deadair/compare/streamdeck-v0.2.1...streamdeck-v0.2.2
[0.2.1]: https://github.com/robert-dean/deadair/compare/streamdeck-v0.2.0...streamdeck-v0.2.1
[0.2.0]: https://github.com/robert-dean/deadair/compare/streamdeck-v0.1.0...streamdeck-v0.2.0
[0.1.0]: https://github.com/robert-dean/deadair/releases/tag/streamdeck-v0.1.0
