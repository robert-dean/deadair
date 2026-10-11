# @deadair/plugin-plex

Airs the music libraries on an operator's own
[Plex Media Server](https://www.plex.tv).

The station talks to the server directly, never through app.plex.tv, and is
handed the address of each record's original file with the token in its query
string, so the player fetches it on its own. No shim, no helper process.

Tested against Plex Media Server 1.43.4 and 1.43.5, the latter behind an HTTPS
reverse proxy.

## Setting it up

| field      | what it is                                                                                     |
| ---------- | ---------------------------------------------------------------------------------------------- |
| Server URL | The server itself, port included: `http://plex.local:32400`. A `plex.direct` address, or the server behind your own reverse proxy, works too. |
| Plex token | Your `X-Plex-Token`. Stored encrypted. See below for where to find it.                          |

### Finding the token

Plex has moved its menus between releases, so there is more than one way:

- In Plex Web, open the browser's developer console and run
  `localStorage.myPlexAccessToken`.
- In Plex Web, open **Get Info → View XML** on an album or a film (recent
  releases do not offer it on a track) and copy the value after `X-Plex-Token=`
  in the address of the page that opens.
- On the server machine, the `PlexOnlineToken` attribute in
  `Library/Application Support/Plex Media Server/Preferences.xml`.

Press **Test connection** once it is filled in. It names the server and the
music libraries the token can see, and fails if it can see none.

### Where the token goes

Every request this plugin makes carries the token in the `X-Plex-Token` header.
Two kinds of address cannot, because whoever fetches them sends no headers of
ours: the file the station airs and the pictures its art cache fetches. Those
carry it in the query string. Treat them as credentials.

A token is your account's: it reaches every library on the server your account
can, and it lasts until you sign that device out. Nothing here writes to Plex.

## The "Everything" playlists

The catalog reaches a provider's tracks through its playlists, and a library may
well have none. So this plugin offers one playlist per music library that the
server did not: **Everything** (or **Everything in _library_** when there is
more than one), which is the whole library, paged, oldest addition first so a
scan running during a sync does not shift a page. They appear after your real
audio playlists, smart ones included.

## Searching

Plex's title filter matches a track's own title, a word at a time and without
regard to punctuation. The station searches with `"<artist> <title>"`, which
that never matches, so each query is read two ways at once:

- as a title, which is Plex's own filter;
- as an artist at the front and a title after it. The artist is looked up by the
  first word of the query (past a leading "The"), their tracks are read, and the
  titles are compared here in the SDK's normal form.

A search for a period is applied to each track's year, its album's when the
track has none of its own, so a track whose year Plex does not know is left out
of it.

## Pasting a playlist link

A Plex Web link to a playlist names the server by its machine id, so a link is
only claimed once the plugin has learnt this server's id, which it does on the
first playlist walk after it is enabled.

## It also enriches

The same plugin is an enrichment source, because Plex's metadata agents fill a
music library with more than its files carry: each record's label and release
date, styles narrower than a genre ("Power Metal" beside "Pop/Rock"), moods, an
artist's biography and picture, and MusicBrainz ids for nearly everything.

It sorts at priority **500**, supplementary: MusicBrainz at 100 wins when both
have an opinion, and this fills the gaps. A track is found by artist and title
(and again without a decoration like "(2011 Remaster)" if that found nothing),
then read whole, because a listing leaves out the label and the moods. A match
needs both the artist and the title to agree; a near miss is no answer, which
the station asks about again later, rather than a wrong one it keeps.

### Which MusicBrainz ids these are

Checked against MusicBrainz itself rather than assumed from where they sit:

| on a   | Plex's `mbid://` is a | filed as              | promoted by the station |
| ------ | --------------------- | --------------------- | ----------------------- |
| artist | artist id             | `musicbrainz-artist`  | yes, onto the artist    |
| album  | **release** id        | `musicbrainz-release` | no                      |
| track  | **track** id          | `musicbrainz-track`   | no                      |

The station's album and track columns hold a release GROUP and a RECORDING, so
the last two are kept beside the other ids and written into neither: filed under
the names those columns promote, they would record the wrong thing.

### When Plex renumbers

A track's id is its rating key, which changes when Plex removes something and
adds it back (a moved folder, a re-created library). An artist or a record whose
remembered key no longer answers is searched for again by MusicBrainz id and
name, and the new key is remembered. Each answer also carries Plex's own id
(`plex://…`, filed as `plex-guid`), which survives such a rescan.

## What it does not do

No transcoding. Plex transcodes through a session-based endpoint built for its
own players, and the station's decoder reads every format a music library
normally holds, so the original file is always what is aired.

No `steer`. deadair owns the running order on purpose.
