# The listening profile the Spotify grant already pays for

**Written:** 2026-08-09, after checking every claim below against Spotify's live docs and the
February/March/May/July 2026 changelogs.
**State of the tree:** `plugins/spotify` requests `user-top-read` and `user-library-read` at
authorize time and calls neither. The capability contract has nowhere to put the answer.

---

## What is already paid for

`SPOTIFY_SCOPES` in [spotify.manifest.ts](../../plugins/spotify/src/spotify.manifest.ts) was carried
over verbatim from the previous station and asks for more than this tree uses. Two of those scopes
are live money left on the table:

| Scope | Endpoint it unlocks | Called today |
| --- | --- | --- |
| `user-top-read` | `GET /me/top/tracks`, `GET /me/top/artists` | no |
| `user-library-read` | `GET /me/tracks` (saved) | no |

Every account that has ever connected the plugin holds a token that can read all three. There is no
re-consent, no manifest change and no new `permissions.network` entry: `api.spotify.com` is already
allowlisted.

`/me/top/{type}` takes `time_range` of `short_term`, `medium_term` or `long_term`, and `limit` 1–50.
Three time ranges times two types is six distinct views of the same account's taste, which is more
signal than the rotation pool has from any other source.

## The gap

[music.provider.ts](../../packages/plugin-sdk/src/capabilities/music.provider.ts) gives
`MusicProviderCatalog` exactly four methods: `searchTracks`, `getTrack`, `listPlaylists`,
`getPlaylistTracks`. There is no shape for "top items" and nothing host-side asks for one.
`ProviderTrack` has no genre field either, which matters because the interesting half of this is
top **artists** and their genre tags, not top tracks.

## Two ways in

**Synthetic playlists, no SDK change.** `listPlaylists` emits `top:short_term`, `top:medium_term`,
`top:long_term` and `saved` alongside the real ones; `getPlaylistTracks` routes those ids to
`/me/top/tracks` and `/me/tracks`. It rides the existing import path end to end and could land in an
afternoon. The ids are namespaced so they cannot collide with a real Spotify playlist id, and their
`permissions` would be `['read']`. It is a small lie: these are not playlists, and a second provider
would have to invent its own namespace to tell the same one.

**A `profile` sub-capability.** An optional `MusicProviderProfile` carrying
`getTopTracks(timeRange)`, `getTopArtists(timeRange)` and `getSavedTracks`, plus a `'profile'`
capability string. The manifest's capability list is `z.array(z.string().min(1))`, deliberately open,
so adding one costs nothing structurally. This is the shape to build if top artists and their genres
are going to feed selection or patter rather than just filling a pool, because it is the only one of
the two with somewhere to put an artist.

They are not exclusive and the first does not block the second. Pick the first for rotation, the
second for taste modelling.

## What February 2026 did and did not take

Checked because the same round is why `getPlaylistTracks` reads `/items` and why `listPlaylists`
reports `permissions` at all. It did not touch this:

- `GET /me/top/{type}` — no removal, no deprecation, `user-top-read` still current.
- `GET /me/tracks` — kept. Only the writes moved, `PUT`/`DELETE /me/tracks` to `PUT`/`DELETE /me/library`.
- `external_ids` — removed from Track and Album in February, **reverted in the March 2026 changelog**.
  So `ProviderTrack.isrc`, the cross-provider join key, is intact. Worth remembering that it was gone
  for a month: Spotify has shown it is willing to pull it.
- `genres` on the Artist object — not on any removal list.

What it took and did not give back: `popularity` on Track, and `followers` and `popularity` on
Artist. There is no popularity signal available from Spotify any more, so a taste model has to rank
on the ordering `/me/top` returns and nothing else.

## Three findings from the same sweep, none of them about top listens

**`user-read-email` and `user-read-private` are now dead weight.** February stripped `country`,
`email`, `explicit_content`, `followers` and `product` from `GET /me`. Those two scopes exist to
unlock exactly those fields. Under the dev-mode cap of five authorized users, asking a person to
consent to their email address for a field the response no longer carries is friction that buys
nothing. Delete both from `SPOTIFY_SCOPES`.

**`account_id` landed in May 2026.** `GET /me` now returns a public, immutable, pseudonymous
identifier, and Spotify recommends it over `id` for linking an account to another service.
`getCurrentUserId` in [spotify.plugin.ts](../../plugins/spotify/src/spotify.plugin.ts) caches
`profile.id`; for its one use, comparing playlist ownership, `id` is still the correct field. This is
a note for whatever first persists a Spotify identity, not a bug.

**Recently-played is the one that costs a re-consent.** `GET /me/player/recently-played` survived
February and is the richest of the three signals, but `user-read-recently-played` is not in
`SPOTIFY_SCOPES`. Adding it re-authorizes every connected account, so batch it with the two removals
above rather than shipping it alone.

Unrelated but load-bearing if the dev-mode limits were pinching: July 2026 raised Client IDs per
developer from 1 to 25 and moved the quota count to the developer account rather than the Client ID.

## Sources

- [February 2026 changelog](https://developer.spotify.com/documentation/web-api/references/changes/february-2026)
- [February 2026 migration guide](https://developer.spotify.com/documentation/web-api/tutorials/february-2026-migration-guide)
- [March 2026 changelog](https://developer.spotify.com/documentation/web-api/references/changes/march-2026)
- [May 2026 changelog](https://developer.spotify.com/documentation/web-api/references/changes/may-2026)
- [July 2026 changelog](https://developer.spotify.com/documentation/web-api/references/changes/july-2026)
- [Get User's Top Items](https://developer.spotify.com/documentation/web-api/reference/get-users-top-artists-and-tracks)
