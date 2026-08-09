# Where the Spotify plugin has fallen behind the Web API

**Written:** 2026-08-09, from a call-by-call read of `plugins/spotify` against the live reference and
the February, March, May and July 2026 changelogs.
**State of the tree:** the plugin absorbed the February 2026 round where it broke things loudly
(`/playlists/{id}/items`, the `item`/`track` dual read, `permissions` on a listing, 403 classified as
`forbidden` rather than `auth`). What is left is the half of that round that breaks nothing until it
does. Items 1 and 2 were fixed the same day this was written; **3 through 6 are still open.**

Companion to [spotify-listening-profile.md](spotify-listening-profile.md), which covers data the
grant already pays for and the plugin never asks for. This file is the opposite: calls the plugin
makes today that the API has moved underneath.

---

## 1. ~~The search limit clamp is wrong, and it is one line from firing~~ Fixed 2026-08-09

**This was a bug, not deferred design**, and was fixed on the spot rather than left here. Recorded
because the reasoning is worth keeping and because it is why `clampLimit` now has a sibling.

`clampLimit` in [spotify.mapping.ts](../../plugins/spotify/src/spotify.mapping.ts) clamps to
`MaxInt<50>` and was shared by all three catalog calls, with
[`searchTracks`](../../plugins/spotify/src/spotify.plugin.ts) feeding it straight into `search()`.
February cut the search endpoint's `limit` to **max 10, default 5**, leaving the other two call sites
alone: `/me/playlists` still takes 50, and `/me/top/{type}` also takes 50. So one shared clamp could
no longer serve all three.

It was not failing only by luck. `PER_PROVIDER_LIMIT` in
[catalog.search.tool.ts](../../apps/api/src/modules/llm/catalog.search.tool.ts) is exactly `10`. A
caller asking for 11 got a 400, `SpotifyResponseValidator` turned it into `upstream`, and the tool
dropped that provider from the results without failing the search, by design. The symptom would have
been a model that quietly could not see the Spotify half of the library.

**What landed:** a separate `clampSearchLimit` capped at 10, rather than lowering `clampLimit`, which
would have needlessly halved playlist paging. Plus `clampSearchOffset` for search's own 1000-row
paging ceiling, which `searchTracks` had been passing through unclamped.

## 2. ~~Omitting the limit means five results now, not twenty~~ Fixed 2026-08-09

Same call site, separate problem, no error to notice: when `options?.limit` was `undefined` the plugin
sent nothing and took Spotify's default, which dropped from 20 to 5 in the same round.

This one had teeth beyond the count. Every writer inherits the rule that a break names only records
the station can play, and `search_catalog` is how that is checked, so a default that silently went to
a quarter depth narrowed what the DJ was permitted to say about the Spotify half of the library.

**What landed:** `clampSearchLimit(undefined)` returns 10 rather than passing `undefined` through, so
the plugin always states its own depth and the next time Spotify moves that default it does not
quietly follow.

## 3. Two scopes in the manifest unlock nothing

`user-read-email` and `user-read-private` in
[spotify.manifest.ts](../../plugins/spotify/src/spotify.manifest.ts) exist for `email`, `country` and
`product` on `GET /me`. February removed all three from the response, along with `explicit_content`
and `followers`. Nothing in the plugin reads them: `testConnection` uses `display_name` and
`getCurrentUserId` uses `id`, and both survived.

**The sequencing for this lives in [listening-loop.md](listening-loop.md)**, which batches it with
adding `user-read-recently-played` so the operator re-consents once rather than three times. Do not
ship it on its own.

## 4. The SDK is a museum, and one of its methods is now a trapdoor

`getPlaylistTracks` already works around `@spotify/web-api-ts-sdk` predating the `/items` rename. The
problem is wider than that one path.

February removed the batch endpoints `GET /tracks`, `/albums` and `/artists` outright, and the SDK's
`tracks.get` is overloaded: a string hits `tracks/{id}`, an array hits the removed `tracks?ids=`.
`getTrack` only ever passes a string, so it is correct today. But the removed shape is one argument
away and would look like an obvious optimisation to whoever next needs several tracks at once. The
same package still ships `audioFeatures` and `audioAnalysis`, for endpoints removed in 2024.

Cheapest durable fix is a comment at the `getTrack` call site naming the overload as removed. The
larger question, worth asking once rather than per incident: whether the SDK is still earning its
place, given the plugin already supplies its own `RequestImplementation`, its own auth strategy, its
own response validator, and now hand-rolls the endpoints the SDK has not caught up with.

## 5. `account_id` and the two jobs one cache is doing

May 2026 added `account_id` to `GET /me`: public, immutable, pseudonymous, and recommended over `id`
for linking an account to another service.

`getCurrentUserId` in [spotify.plugin.ts](../../plugins/spotify/src/spotify.plugin.ts) caches
`profile.id` and feeds it to two callers that do not obviously want the same field:

- **playlist ownership** in `mapPlaylist`, comparing against `playlist.owner.id`. `id` is correct
  here and `account_id` would be wrong.
- **the librespot login username** in `resolveStreamUrl`. Unverified which field the accesspoint
  expects.

So this is not a rename. It is a question about whether one cached value should be serving both, and
it needs a live check against the accesspoint before anything is changed. It becomes urgent the first
time something persists a Spotify identity, because `id` is not guaranteed stable and `account_id`
is.

## 6. Development mode now requires the owner's Premium subscription

Operator-facing rather than code. Since February the owner of a development-mode app must hold an
active Premium subscription and the app stops working if it lapses, alongside the five-authorized-user
cap.

The failure mode is a station that has worked for months going 403 one morning for a reason nowhere
in this repo explains. `upstreamReason` in
[spotify.fetch.ts](../../plugins/spotify/src/spotify.fetch.ts) will surface Spotify's own sentence,
which is exactly why that extractor exists, but the plugin's setup copy should say it up front.

July 2026 eased the other half of the same round: Client IDs per developer went from 1 to 25 and the
quota is now counted per developer account rather than per Client ID.

## What was checked and is fine

Worth recording so the next pass does not re-verify it: `GET /me/playlists` is current and not
deprecated (max limit 50, offset 100,000, and its items still carry `owner`, `collaborative` and both
`items.total` and the deprecated `tracks.total`, both of which `mapPlaylist` reads). The player
endpoints the steer half uses are all current. `external_ids` was removed in February and **reverted
in March**, so `mapTrack` reading `isrc` is safe. `display_name` survived. The removed
`GET /users/{id}/playlists` is not a path this plugin takes.

## Sources

- [February 2026 changelog](https://developer.spotify.com/documentation/web-api/references/changes/february-2026)
- [February 2026 migration guide](https://developer.spotify.com/documentation/web-api/tutorials/february-2026-migration-guide)
- [March 2026 changelog](https://developer.spotify.com/documentation/web-api/references/changes/march-2026)
- [May 2026 changelog](https://developer.spotify.com/documentation/web-api/references/changes/may-2026)
- [July 2026 changelog](https://developer.spotify.com/documentation/web-api/references/changes/july-2026)
- [Search](https://developer.spotify.com/documentation/web-api/reference/search)
- [Get Current User's Playlists](https://developer.spotify.com/documentation/web-api/reference/get-a-list-of-current-users-playlists)
