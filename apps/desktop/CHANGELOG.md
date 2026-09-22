# Changelog

Notable changes to the desktop listener and operator desk, newest first. Its version is `<Version>`
in `Directory.Build.props`, mirrored there from this directory's `package.json` by
`pnpm release:version`; entries are written from changesets naming `@deadair/desktop`. A release is
the Desktop release workflow, run by hand, which tags `desktop-v<version>`. The station's own
changes are in the [root changelog](../../CHANGELOG.md).

## [Unreleased]

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

[Unreleased]: https://github.com/robert-dean/deadair/compare/desktop-v0.2.4...HEAD
[0.2.4]: https://github.com/robert-dean/deadair/compare/desktop-v0.2.3...desktop-v0.2.4
[0.2.3]: https://github.com/robert-dean/deadair/compare/desktop-v0.2.2...desktop-v0.2.3
[0.2.2]: https://github.com/robert-dean/deadair/compare/desktop-v0.2.1...desktop-v0.2.2
[0.2.1]: https://github.com/robert-dean/deadair/compare/desktop-v0.2.0...desktop-v0.2.1
[0.2.0]: https://github.com/robert-dean/deadair/compare/desktop-v0.1.0...desktop-v0.2.0
[0.1.0]: https://github.com/robert-dean/deadair/releases/tag/desktop-v0.1.0
