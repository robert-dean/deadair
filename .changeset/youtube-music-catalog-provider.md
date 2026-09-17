---
'@deadair/plugin-ytmusic': minor
---

A YouTube Music provider the station can search and play

Search YouTube Music, import the playlists on your account, and air them. It
reaches the live sets, sessions and uploads that are on no streaming service.

**It needs a Music Premium account**, the same way the Spotify path does, and not
by anyone's choice here: YouTube serves free accounts a streaming protocol the
station cannot fetch, so a free account plays nothing at all. The plugin reports
that in those words rather than leaving records that quietly never play.

Audio is resolved by `ytaudio/`, a new bundled Python service on yt-dlp, because
the library that knows how to resolve a YouTube URL is Python and the plugin is
Node inside the API process. **Nothing proxies bytes.** What it answers is an
ordinary HTTPS URL carrying its own authentication, which the station fetches and
caches exactly as it does a Navidrome URL, so the playout chain is untouched and
no audio passes through the new process.

The cookie has no refresh and expires on the account's own schedule. Because
YouTube serves search to signed-out callers, an expired cookie would otherwise
leave the station searching happily while the library went dark. So the plugin
proves the credential by using it, at startup and behind Test connection, and
reports a dead one as an authorization failure rather than as trouble at YouTube.
Test connection reports the catalog half and the audio half separately, because
they fail independently.
