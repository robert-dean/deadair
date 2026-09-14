# Changelog

Notable changes to the desktop listener and operator desk, newest first. Its version is `<Version>`
in `Directory.Build.props`, mirrored there from this directory's `package.json` by
`pnpm release:version`; entries are written from changesets naming `@deadair/desktop`. A release is
the Desktop release workflow, run by hand, which tags `desktop-v<version>`. The station's own
changes are in the [root changelog](../../CHANGELOG.md).

## [Unreleased]

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

[Unreleased]: https://github.com/robert-dean/deadair/compare/desktop-v0.2.1...HEAD
[0.2.1]: https://github.com/robert-dean/deadair/compare/desktop-v0.2.0...desktop-v0.2.1
[0.2.0]: https://github.com/robert-dean/deadair/compare/desktop-v0.1.0...desktop-v0.2.0
[0.1.0]: https://github.com/robert-dean/deadair/releases/tag/desktop-v0.1.0
