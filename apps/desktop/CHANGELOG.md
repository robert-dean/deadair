# Changelog

Notable changes to the desktop listener and operator desk, newest first. Its version is `<Version>`
in `Directory.Build.props`, mirrored there from this directory's `package.json` by
`pnpm release:version`; entries are written from changesets naming `@deadair/desktop`. A release is
the Desktop release workflow, run by hand, which tags `desktop-v<version>`. The station's own
changes are in the [root changelog](../../CHANGELOG.md).

## [Unreleased]

## [0.1.0] — 2026-09-09

- The desktop listener and operator desk, for macOS on Apple Silicon. Point it at your station's
  address on first run. Listening needs no account; the desk appears when you sign in as the
  operator.
- It is unsigned, so the first launch needs a right-click and Open.

[Unreleased]: https://github.com/robert-dean/deadair/compare/desktop-v0.1.0...HEAD
[0.1.0]: https://github.com/robert-dean/deadair/releases/tag/desktop-v0.1.0
