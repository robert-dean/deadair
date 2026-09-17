# Changelog

Notable changes to the Stream Deck plugin, newest first. Its version is `package.json`'s, mirrored
into the plugin manifest's four-part `Version` by `pnpm release:version`; entries are written from
changesets naming `@deadair/streamdeck`. A release cuts itself on the push to main that moves that
version (the merge of the version pull request), tagged `streamdeck-v<version>`. The station's own changes are in the
[root changelog](../../CHANGELOG.md).

## [Unreleased]

## [0.2.0] — 2026-09-17

- Like and Dislike: two new keys that set what the station thinks of the record on air, the same opinion you would set from the running order in the console. A like plays that record more often and a dislike means never again. Both draw the station's own skull on a heart, and the heart fills with colour when the station already agrees; pressing the lit one takes the opinion back. Both need an API key issued with Read and manage; a Read-only key still shows you what the station thinks.

## [0.1.0] — 2026-09-15

- The first release: a Now Playing key with the cover and a moving playhead, Skip, and a Stop key that asks for a second press before it takes the station off air and becomes Start once it has.
- Each Now Playing key can leave out the progress bar, or the title and artist, from its own settings.
- With no cover to show, the Now Playing key shows the deadair mark, faint while the station is stopped or not answering. When the station stops answering, the last cover stays on the key, faint.

[Unreleased]: https://github.com/robert-dean/deadair/compare/streamdeck-v0.2.0...HEAD
[0.2.0]: https://github.com/robert-dean/deadair/compare/streamdeck-v0.1.0...streamdeck-v0.2.0
[0.1.0]: https://github.com/robert-dean/deadair/releases/tag/streamdeck-v0.1.0
