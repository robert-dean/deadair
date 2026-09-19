---
'@deadair/plugin-ytmusic': minor
---

A YouTube Music provider the station can search and play

Search YouTube Music and import the playlists on your account, signed in with a
cookie you paste. It reaches the live sets, sessions and uploads that are on no
streaming service.

Audio is resolved by `ytaudio/`, a new bundled Python service on yt-dlp that
turns a track into a URL the station fetches itself, with nothing proxied. It
resolves **signed out**: the cookie is used for search and your library only and
never reaches the resolver, because YouTube serves signed-in sessions nothing the
station can fetch, Music Premium included. A record that only an account may play
(age-gated, members-only) is skipped rather than aired.

The cookie has no refresh and expires on the account's own schedule. Because
YouTube serves search to signed-out callers, an expired cookie would otherwise
leave the station searching happily while the library went dark. So the plugin
proves the credential by using it, at startup and behind Test connection, and
reports a dead one as an authorization failure rather than as trouble at YouTube.
