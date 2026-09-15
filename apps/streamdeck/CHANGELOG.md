# Changelog

Notable changes to the Stream Deck plugin, newest first. Its version is `package.json`'s, mirrored
into the plugin manifest's four-part `Version` by `pnpm release:version`; entries are written from
changesets naming `@deadair/streamdeck`. A release cuts itself on the push to main that moves that
version (the merge of the version pull request), tagged `streamdeck-v<version>`. The station's own changes are in the
[root changelog](../../CHANGELOG.md).

## [Unreleased]

## [0.1.0] — 2026-09-15

- The first release: a Now Playing key with the cover and a moving playhead, Skip, and a Stop key that asks for a second press before it takes the station off air and becomes Start once it has.
- Each Now Playing key can leave out the progress bar, or the title and artist, from its own settings.
- With no cover to show, the Now Playing key shows the deadair mark, faint while the station is stopped or not answering. When the station stops answering, the last cover stays on the key, faint.

[Unreleased]: https://github.com/robert-dean/deadair/compare/streamdeck-v0.1.0...HEAD
[0.1.0]: https://github.com/robert-dean/deadair/releases/tag/streamdeck-v0.1.0
