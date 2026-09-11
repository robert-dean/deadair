# @deadair/plugin-navidrome

Airs an operator's own music library. Talks the Subsonic API, which is what
[Navidrome](https://www.navidrome.org) serves.

This is the ordinary provider shape the SDK was designed around, and the
opposite of the Spotify plugin's: Subsonic authenticates in the query string, so
this plugin mints a URL that carries its own credentials and the player fetches
it directly. No shim, no helper process, no session to lend.

## Setting it up

| field           | what it is                                                                                                                                       |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Server URL      | The root of your server (`http://navidrome.local:4533`), without `/rest`.                                                                        |
| Username        | The account deadair reads the library as. See the note below before reaching for a dedicated one.                                                |
| Password        | That account's password. Stored encrypted, and never sent as-is: every request carries a salted MD5 of it, which is what Subsonic specifies.     |
| Stream format   | `Original file` unless your library holds something the player cannot decode. Transcoding costs the Navidrome machine CPU for every track aired. |
| Maximum bitrate | Only applies when transcoding. Blank means no limit.                                                                                             |

Press **Test connection** once it is filled in: `ping` is authenticated, so a
success proves the URL, the account and the password together.

### Which account, and why it decides what you see

Playlists in Navidrome belong to a user. `getPlaylists` returns the ones the
authenticated account **owns**, plus any marked **public** — so a dedicated
`deadair` account sees none of the playlists you made under your own login, and
the plugin will offer only "Everything".

Two ways out, and the second is usually better:

- Point the plugin at the account that owns the playlists.
- Keep the dedicated account and mark the playlists you want aired as public in
  Navidrome (the playlist's own settings).

Nothing else is account-scoped this way: the library, its tracks and their tags
are the same whichever account reads them. It is only playlists.

## The "Everything" playlist

The catalog reaches a provider's tracks through its playlists, and a Navidrome
library may well have none — ripping your own CDs and letting deadair do the
picking is a complete setup with an empty playlist list. So this plugin offers
one playlist the server did not: **Everything**, which is the whole library,
paged. It appears after your real playlists.

## It also enriches

The same plugin is an enrichment source, because your files carry facts no
external service has: a bootleg, a self-release, a local band, a compilation
somebody tagged by hand. MusicBrainz has never heard of any of them, and the
tags are the only description that exists.

It sorts at priority **600**, which is supplementary — MusicBrainz at 100 wins
when both have an opinion, and this fills the gaps. It matches on artist and
title, since Subsonic exposes no ISRC, and scores the candidates rather than
taking the first result: a library holding an album track, a live version and a
greatest-hits copy returns all three, and the right one is not reliably first.

A track the library does not have gets an empty answer, which the host records
as a miss on a short clock rather than as a failure. So enriching a catalog that
is mostly some other provider's tracks costs one search per track per week, not
a stream of errors.

There is deliberately no batch form. `enrichTracks` exists for sources paced at
a request per second, where one query answering twenty-five tracks is the
difference between one second and twenty-five. Subsonic has no bulk lookup, so a
batch here would be twenty-five searches under a single deadline instead of
twenty-five under twenty-five — strictly worse, since a slow tail would throw
away answers the per-track path keeps.

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

## Developing it against a running server

The plugin is bundled: it is on the host's own list in
`apps/api/src/modules/plugins/plugins.bundled.ts`, and `pnpm dev` loads it from
`plugins/navidrome/dist`. So the loop is to build it, because the host loads
`dist/` and not `src/`:

```bash
pnpm --filter @deadair/plugin-navidrome build
```

and then to restart the API. `POST /plugins/deadair.navidrome/reload` re-runs
`init` against the new settings, but it does not load new code: Node caches an ES
module by its URL for the life of the process, so a reload or a rescan is handed
the module the host imported at boot. If you forget the build, the plugin is
quarantined with a message saying so rather than an import stack.

Symlinking this directory into `PLUGINS_DIR` as well (`apps/api/data/plugins` in
a dev checkout) does not give you a second copy to work on: the bundled copy is
loaded first and keeps the id, and the symlinked one is quarantined as a
duplicate.
