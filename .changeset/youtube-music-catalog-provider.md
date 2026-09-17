---
'@deadair/plugin-ytmusic': minor
---

A YouTube Music provider the station can search

Search YouTube Music and import the playlists on your account, signed in with a cookie you paste:
the live sets, sessions and uploads that are on no streaming service become findable from the
console and from the station's own search.

**Records from it cannot be played yet.** The plugin declares `catalog` and not `stream`, so the
running order skips them. A YouTube audio URL only works for the client identity that asked for it,
and the player fetches a provider URL with no headers from us, so serving one needs a piece the
station has not got.

The cookie has no refresh and expires on the account's own schedule. Because YouTube serves search
to signed-out callers, an expired cookie would otherwise leave the station searching happily while
the library went dark. So the plugin proves the credential by using it, at startup and behind Test
connection, and reports a dead one as an authorization failure rather than as trouble at YouTube.
