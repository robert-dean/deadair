---
'@deadair/plugin-ytmusic': minor
---

A YouTube Music provider the station can search

Search YouTube Music and import the playlists on your account, signed in with a
cookie you paste. It reaches the live sets, sessions and uploads that are on no
streaming service.

**Its audio does not play yet.** Audio is resolved by `ytaudio/`, a new bundled
Python service on yt-dlp that turns a track into a URL the station fetches
itself, with nothing proxied. The plumbing is complete and proved end to end. What
stops it is upstream: YouTube currently forces its segment streaming protocol on
signed-in sessions, which yt-dlp cannot fetch, and the yt-dlp tracker reports that
for Music Premium accounts too. The plugin says so in those words rather than
leaving records that quietly never play.

The cookie has no refresh and expires on the account's own schedule. Because
YouTube serves search to signed-out callers, an expired cookie would otherwise
leave the station searching happily while the library went dark. So the plugin
proves the credential by using it, at startup and behind Test connection, and
reports a dead one as an authorization failure rather than as trouble at YouTube.
