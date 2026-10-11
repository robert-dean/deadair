# @deadair/plugin-jellyfin

Airs the music library on an operator's own [Jellyfin](https://jellyfin.org)
server.

The same provider shape as the Navidrome plugin's: Jellyfin accepts its key in
the query string, so this plugin mints a URL that carries its own credentials
and the player fetches it directly. No shim, no helper process, no session to
lend.

Tested against Jellyfin 10.11.0.

## Setting it up

| field           | what it is                                                                                                                                        |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Server URL      | The root of your server (`http://jellyfin.local:8096`), as you would type it into a browser. Include the base path if you serve it under one.     |
| API key         | Made in the Jellyfin dashboard, under **API Keys**. Stored encrypted.                                                                             |
| Username        | The Jellyfin user deadair reads the library as. See below.                                                                                        |
| Stream format   | `Original file` unless your library holds something the player cannot decode. Transcoding costs the Jellyfin machine CPU for every track aired.   |
| Maximum bitrate | Only applies when transcoding. Blank means no limit.                                                                                              |

Press **Test connection** once it is filled in. It proves the URL, the key and
the user together.

### Why a user as well as a key

An API key belongs to no user, and Jellyfin will not list a playlist's contents
without one. The user also decides which libraries the station sees: a user
with access to the music library only keeps a film library's soundtracks out of
the catalog.

### Where the key goes

Every request this plugin makes carries the key in the `Authorization` header.
The address the station fetches a record from cannot, because the player sends
no headers of ours, so that one carries it as `ApiKey` in the query string.
Treat it like the Navidrome plugin's stream address: it is a credential.

Jellyfin 10.11.0 serves the stream endpoint without checking the key at all
(measured: no key and a wrong key both returned audio). The key is sent anyway,
so the address keeps working on a server or a release that does check.

## The "Everything" playlist

The catalog reaches a provider's tracks through its playlists, and a library
may well have none. So this plugin offers one playlist the server did not:
**Everything**, which is the whole library, paged, oldest addition first so a
scan running during a sync does not shift a page. It appears after your real
playlists.

## Searching

Jellyfin's search matches a track's NAME and nothing else, and compares
punctuation literally. The station searches with `"<artist> <title>"`, which a
name-only search never matches, so each query is read two ways at once:

- as a title, which is Jellyfin's own search;
- as an artist at the front and a title after it. The artist is looked up by
  the first word of the query (past a leading "The"), their tracks are read, and
  the titles are compared here in the SDK's normal form, so `Mr Brightside`
  finds `Mr. Brightside`.

A search for a period is honoured through Jellyfin's `Years` filter, so a track
whose file carries no year is left out of it.

## What it does not do yet

No enrichment. Jellyfin carries MusicBrainz ids, genres and years from the
files' tags, and reading them is the next change.

No `steer`. That capability is for a provider that owns its own audio output,
which is the Spotify Connect shape; deadair owns the running order on purpose.
