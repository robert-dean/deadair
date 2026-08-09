# A YouTube Music provider, and why its audio is not a URL

**Written:** 2026-08-09, after checking the current state of YouTube's playback stack rather than
assuming it still looks the way downloaders describe it.
**State of the tree:** two music providers, `plugins/spotify` and `plugins/navidrome`. One track
fetcher, hardwired: `PluginHostFactory.createTrackFetcher` calls `SpotifyShimClient.serve` and there
is no lookup in front of it.

---

## The split

This provider is two unrelated problems wearing one name, and they should be scoped, estimated and
built separately.

**The catalog half is ordinary.** Search, library, playlists. It is in-process plugin code against
an HTTP API, the same shape as the Spotify plugin, and it needs nothing from the host that does not
already exist.

**The audio half is not a URL.** `MusicProviderStream.resolveStreamUrl` is specified to return "a
complete URL that carries its own authentication, because the player fetches it with no headers from
us". For this provider there is no such URL to return, and no longer even a signed URL that a plain
`GET` could consume — the audio arrives over a session-oriented protocol. That is a sidecar, and it
is the whole cost of the feature.

Everything below is ordered by that split.

## The catalog half

### The official API cannot feed a rotation pool

The published Data API covers the video site rather than the music service, and its quota settles it
before the shape of the data does: a search costs 100 units against a 10,000-unit daily default, so
an install gets roughly a hundred searches a day for the entire station. `catalog.enrich`, live
provider search and the rotation sync would exhaust that before lunch. Anything worth building here
speaks the app's own InnerTube endpoints instead, with the maintenance that implies (see
[Cost of ownership](#cost-of-ownership)).

### The client is a Node library, so this is plugin code

`youtubei.js` is a TypeScript InnerTube client covering search, library and playlists. It runs
in-process the way every other plugin does, needs no sidecar and no new process, and it accepts a
caller-supplied fetch implementation — which means catalog traffic can be routed through
`host.fetch` and stay inside the manifest's `permissions.network` allowlist rather than going around
it. Confirm that against whichever version gets pinned; it is the difference between an honest
manifest and a decorative one.

### Two things the capability contract does not fit

**No ISRC.** `ProviderTrack.isrc` is documented as "the best cross-provider join key" and this
source does not expose one. Every track imported from here lands without it, which weakens dedupe
against the same recording from Spotify or Navidrome and weakens enrichment, whose MusicBrainz path
is at its cheapest when it has an ISRC to look up. Not a blocker, but it means this provider's
tracks are second-class in the catalog until something else identifies them.

**Auth is a pasted credential, not a redirect.** The internal endpoints authenticate off a
logged-in browser session; the tell-tale is that the cookie has to carry `__Secure-3PAPISID`, which
a cookie captured from an unauthenticated request does not. That is a `secret` config field on the
manifest, entered once by the operator, not `MusicProviderOAuth.getAuthorizeUrl`/`handleCallback`.
So the manifest declares `catalog` and eventually `stream`, and **not** `oauth`. It also means there
is no refresh: the credential expires on the account's own schedule and the plugin has to fail
legibly when it does, rather than reporting an empty catalog.

`steer` is out too. There is no transport to drive.

## The audio half

### What changed, and why the old answers stop working

Three findings, each of which independently kills the mint-a-URL approach:

- **The music client is served over the adaptive segment protocol.** It is not DASH or HLS: audio
  and video segments come back in one custom-framed response, addressed by player time and buffered
  ranges rather than byte ranges. ffmpeg cannot consume it, and neither can Liquidsoap, which is the
  same thing for our purposes. Tracked upstream as `yt-dlp/yt-dlp#13037`.
- **Origin tokens are bound per video id.** Passing one token by hand is no longer a workaround
  even for a single track; obtaining them means running an attestation service continuously.
- **The fallbacks are gone or going.** Reports exist of the segment protocol being forced even with
  a valid token provider and a paid account (`yt-dlp/yt-dlp#14390`), so "we will fall back to a
  plain format" is not a plan that can be relied on.

The consequence for us is narrow and total: `resolveStreamUrl` cannot mint anything. The only URL
this plugin can return is one pointing at a process of ours that has already spoken the protocol,
which is exactly the arrangement `host.trackFetcher` exists for and exactly the arrangement
`SpotifyShimClient` says a second provider would earn.

### Two ways to build the fetcher

Both need an attestation service alongside them, running continuously and reachable from the fetcher
(the reference implementation is an HTTP service on 4416 with published images). That is a container
either way; it is not a differentiator.

| | Fetcher on `yt-dlp` | Fetcher on `googlevideo`'s SABR client |
| --- | --- | --- |
| Language | Python, plus a wrapper that re-serves | TypeScript, same as the rest of the tree |
| Protocol work | inherited, and actively maintained upstream | ours, on a library that tracks the same protocol |
| Track record | the widest-deployed implementation | fewer deployments, same author as `youtubei.js` |
| Failure mode | extraction breaks, upstream ships a fix, we pull it | extraction breaks, we wait or fix it |
| Release cadence to keep up with | roughly fortnightly | whatever the library does |

The honest read is that the first option buys someone else's arms race and the second buys a tree
that is all one language. Given how often the protocol moves, inheriting the maintenance is worth
more than the language consistency, so **start from `yt-dlp`** and treat the TypeScript client as
the fallback if the wrapper turns out to be the fragile part.

One thing to settle deliberately rather than by accident: "audio never touches Node" is about the
API process, not about every process we own. A Node sidecar beside Liquidsoap does not violate it,
but it should be an argued exception if it happens.

## What has to change in this tree

Ordered by how load-bearing it is, not by size.

**`host.trackFetcher` stops being singular.** `PluginHostFactory.createTrackFetcher` currently
checks the `trackFetcher` permission and then calls `SpotifyShimClient.serve` unconditionally. The
comment there is explicit that this is deliberate and that a second provider needing its own helper
is what earns the indirection. This is that provider. The minimum change is a lookup keyed by plugin
id, resolving to one of two clients; the SDK's `PluginTrackFetcher` interface does not change,
because it is already general.

**`TrackFetchSession` is the wrong shape.** It is `{ username, accessToken, expiresAt }`, which is
one provider's credential model wearing a general name. This provider lends either a cookie or
nothing at all. Two options, and the second is better:

- Widen the type to a union of credential shapes, so the host keeps brokering the login.
- **Let the fetcher hold its own credential**, and have the plugin lend nothing. The operator
  configures the sidecar directly and the plugin only ever asks for a URL by track id. This drops a
  secret out of the request path entirely, and it is closer to how the sidecar has to work anyway,
  since attestation is stateful and per-process rather than per-call.

If the second is chosen, note it splits configuration across two places — the plugin knows the
catalog credential, the sidecar knows the playback one, and they can be for different accounts, so
the console cannot present one connected/disconnected answer. Worth stating in the settings copy
rather than discovering.

**Nothing else, and that is the good news.** URL signing, the 30-minute TTL, and the bridge secret
already exist in `SpotifyShimClient` and are provider-agnostic. `implementsStream` already requires
both the declaration and the method, so a plugin that declares only `catalog` is a supported state
rather than a broken one: the running order asks `asStreamPlugin`, gets `undefined`, skips the item
and holds nothing against the plugin. That is what makes the phasing below real rather than
cosmetic.

## Phases

Each stands alone as a commit and leaves the tree working.

1. **Catalog only.** `plugins/youtube-music` on `youtubei.js`, manifest declaring `capabilities:
   ['catalog']`, cookie as a `secret` config field, no `resolveStreamUrl` and no `trackFetcher`
   permission. Search and playlist import work in the console; nothing airs, by design. This is the
   phase that proves the credential model and the InnerTube client before any container work.
2. **Generalise the fetcher.** Turn `createTrackFetcher`'s hardwired call into a lookup keyed by
   plugin id, with Spotify as the only entry and behaviour unchanged. Pure refactor, tested against
   the existing Spotify path, no new provider involved.
3. **The sidecar.** The fetcher plus the attestation service in `docker-compose`, re-serving plain
   audio over HTTP and signed with the bridge secret the way the existing shim is. Verifiable on its
   own with `curl` before any plugin knows about it.
4. **Wire it up.** Register the sidecar's client under the new plugin's id, add `resolveStreamUrl`,
   flip the manifest to `['catalog', 'stream']`. This is the commit where tracks start airing.

## Cost of ownership

The reason to write this section rather than only the phases: everything above is buildable, and the
question is whether it should be built.

This is the first dependency in the tree that is actively adversarial. Spotify's API is published
and versioned, and its shim speaks a protocol that changes rarely. This one changes on the upstream's
schedule, without notice, in a direction chosen specifically to stop what we are doing. A break here
is not a bug we introduced and not one we can fix on our own timetable: it is silence on a mount
until someone else ships an extraction fix. The audience gate limits the damage — an unresolvable
item is skipped, not waited for — so the failure is a thinner rotation rather than dead air. But
"thinner rotation, cause upstream, ETA unknown" is a state the station will be in periodically and
forever.

Set against that, the thing it actually buys: material that is on no streaming service. Live sets,
sessions, uploads, mixes. If that is the reason, it is a good reason and the catalog half alone does
not deliver it — phase 1 without phase 4 is a search box that cannot play anything. If the reason is
instead "more catalog than Spotify has", this is a large permanent maintenance commitment for an
overlap that is mostly already covered.

There is also the licence question, which is a decision rather than an engineering problem and
belongs to the operator: this is a source with no published playback API and terms that do not
contemplate what the sidecar does. It is a plugin an install can choose to run, not a thing to ship
enabled.
