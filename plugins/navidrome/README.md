# @deadair/plugin-navidrome

Airs an operator's own music library. Talks the Subsonic API, which is what
[Navidrome](https://www.navidrome.org) serves.

This is the ordinary provider shape the SDK was designed around, and the
opposite of the Spotify plugin's: Subsonic authenticates in the query string, so
this plugin mints a URL that carries its own credentials and the player fetches
it directly. No shim, no helper process, no session to lend.

## Setting it up

| field | what it is |
| ----- | ---------- |
| Server URL | The root of your server (`http://navidrome.local:4533`), without `/rest`. |
| Username | An account deadair reads the library as. Worth making a dedicated one. |
| Password | That account's password. Stored encrypted, and never sent as-is: every request carries a salted MD5 of it, which is what Subsonic specifies. |
| Stream format | `Original file` unless your library holds something the player cannot decode. Transcoding costs the Navidrome machine CPU for every track aired. |
| Maximum bitrate | Only applies when transcoding. Blank means no limit. |

Press **Test connection** once it is filled in: `ping` is authenticated, so a
success proves the URL, the account and the password together.

## The "Everything" playlist

The catalog reaches a provider's tracks through its playlists, and a Navidrome
library may well have none — ripping your own CDs and letting deadair do the
picking is a complete setup with an empty playlist list. So this plugin offers
one playlist the server did not: **Everything**, which is the whole library,
paged. It appears after your real playlists.

## What it does not do

No `steer`. That capability is for a provider that owns its own audio output and
takes instructions, which is the Spotify Connect shape. Subsonic's equivalent is
`jukeboxControl`, and it plays to the Navidrome machine's own soundcard — no use
to a station broadcasting to Icecast, and it would take the running order away
from deadair, which owns it on purpose.

No ISRCs either: Subsonic has no field for one. That is why the enrichment side
of this plugin matches on artist and title.

## Artwork carries credentials

Cover art URLs are Subsonic URLs, so they carry the same salted token every
other request does. Until the art cache fetches bytes server-side, the console
requests these URLs directly, which means that token reaches the browser. It is
a hash scoped to a server the operator runs and is not the password, but it is
worth knowing rather than assuming otherwise.

The salt for those URLs is fixed for the life of the plugin instance, unlike
every other call's. `art_assets` rows are keyed by their source URL, so a URL
that varied per call would mean a new row and a fresh download of identical
bytes every time the same image was mentioned.

## Installing it as an operator would

The plugin is not bundled with the station: it is discovered under `PLUGINS_DIR`
(`apps/api/data/plugins` by default, `./.docvol/plugins` in the prod compose
overlay). To develop against a running server, symlink it — the loader follows
symlinks for exactly this reason:

```bash
mkdir -p apps/api/data/plugins && ln -s ../../../../plugins/navidrome apps/api/data/plugins/navidrome
```

Then build it, because the host loads `dist/` and not `src/`:

```bash
pnpm --filter @deadair/plugin-navidrome build
```

After a code change: rebuild, then `POST /plugins/deadair.navidrome/reload`. No
server restart. If you forget the build, the plugin is quarantined with a
message saying so rather than an import stack.
