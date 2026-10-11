# @deadair/plugin-emby

Airs the music library on an operator's own [Emby](https://emby.media) server.

The same provider shape as the Navidrome and Jellyfin plugins': Emby accepts its
key in the query string, so this plugin mints a URL that carries its own
credentials and the player fetches it directly. No shim, no helper process, no
session to lend.

Emby and Jellyfin share an ancestor, and this plugin started as a copy of the
Jellyfin one. They have drifted far enough apart that one plugin for both would
be wrong in several places at once; the differences are listed below, each one
measured on Emby 4.10.1.

Tested against Emby Server 4.10.1.

## Setting it up

| field           | what it is                                                                                                                                    |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Server URL      | The root of your server (`http://emby.local:8096`), as you would type it into a browser. Include the base path if you serve it under one.    |
| API key         | Made in Emby's server settings, under **Advanced → API Keys**. Stored encrypted.                                                              |
| Username        | The Emby user deadair reads the library as. See below.                                                                                        |
| Stream format   | `Original file` unless your library holds something the player cannot decode. Transcoding costs the Emby machine CPU for every track aired.   |
| Maximum bitrate | Only applies when transcoding. Blank means no limit.                                                                                          |

Press **Test connection** once it is filled in. It proves the URL, the key and
the user together.

### Why a user as well as a key

An API key belongs to no user. The user decides which libraries and playlists
the station sees: a user with access to the music library only keeps a film
library's soundtracks out of the catalog.

### Where the key goes

Every request this plugin makes carries the key in a header. The address the
station fetches a record from cannot, because the player sends no headers of
ours, so that one carries it as `api_key` in the query string (Emby does not
read Jellyfin's `ApiKey`). Emby refuses that address without the key, so it is
a credential: treat it like the Navidrome plugin's stream address.

## The "Everything" playlist

The catalog reaches a provider's tracks through its playlists, and a library
may well have none. So this plugin offers one playlist the server did not:
**Everything**, which is the whole library, paged, oldest addition first so a
scan running during a sync does not shift a page. It appears after your real
playlists.

## Every playlist, video ones included

Emby cannot be asked for audio playlists only. Adding a media type to the
playlist query makes it drop the playlist filter and answer with every item in
the library, and a playlist carries no media type to sort by afterwards. So
every playlist the user can see is listed, and a video playlist syncs no
tracks.

## Searching

Emby's search matches a track's NAME and nothing else. It ignores punctuation,
unlike Jellyfin's, but the station searches with `"<artist> <title>"`, which a
name-only search never matches, so each query is read two ways at once:

- as a title, which is Emby's own search;
- as an artist at the front and a title after it. The artist is looked up by
  the first word of the query (past a leading "The"), their tracks are read, and
  the titles are compared here in the SDK's normal form.

A search for a period is honoured through Emby's `Years` filter, so a track
whose file carries no year is left out of it.

## Where Emby differs from Jellyfin

| Emby 4.10.1                                                       | Jellyfin 10.11.0                       | what this plugin does                                                   |
| ----------------------------------------------------------------- | -------------------------------------- | ----------------------------------------------------------------------- |
| item ids are numbers (`"12"`)                                     | 32-hex GUIDs                           | checks an id is a number before asking                                  |
| the stream key is `api_key`, and required                         | `ApiKey`, and not checked              | sends `api_key`                                                         |
| a track's year only when `Fields=ProductionYear` asks             | sent unasked                           | asks on every track query                                               |
| `MediaTypes=Audio` turns off the playlist filter                  | filters                                | lists every playlist                                                    |
| a missing playlist answers 500                                    | 400                                    | checks the item on a 500 before calling it missing                      |
| some ids it does not hold answer with the library's folder        | the user's top-level folders           | keeps only an answer that is the id asked for                           |
| search ignores punctuation                                        | compares it literally                  | matches titles locally either way                                       |

## What it does not do yet

No enrichment. Emby carries MusicBrainz ids, genres and years from the files'
tags, and reading them is the next change.

No `steer`. That capability is for a provider that owns its own audio output,
which is the Spotify Connect shape; deadair owns the running order on purpose.
