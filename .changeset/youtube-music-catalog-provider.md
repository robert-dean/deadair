---
'@deadair/plugin-ytmusic': minor
---

A YouTube Music provider the station can search

A YouTube Music provider: search and playlist import, signed in with a cookie the operator pastes.

**It is not switched on.** The plugin is built, tested and shipped in the image, and deliberately
left out of `bundledPluginDirs`, so no station loads it. **Records from it cannot be played yet**, The plugin declares `catalog` and not `stream`, so the
running order skips them. A YouTube audio URL only works for the client identity that asked for it,
and the player fetches a provider URL with no headers from us, so serving one needs a piece the
station has not got. Enabling it anyway would cost four failed fetches and four operator-facing
`item.unavailable` events per imported record, which is why the line is left out rather than the
plugin merely left disabled.

The cookie has no refresh and expires on the account's own schedule. Because YouTube serves search
to signed-out callers, an expired cookie would otherwise leave the station searching happily while
the library went dark. So the plugin proves the credential by using it, at startup and behind Test
connection, and reports a dead one as an authorization failure rather than as trouble at YouTube.
