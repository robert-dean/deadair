# A YouTube Music provider, and why its audio is not a URL

**Written:** 2026-08-09, after checking the current state of YouTube's playback stack rather than
assuming it still looks the way downloaders describe it.
**Re-checked:** 2026-08-25. The plan survives intact and three of its premises did not. The segment
protocol has a maintained MIT implementation, so the option dismissed below as "large, permanent" is
an import rather than a project. The licence warning at the bottom was wrong: the JavaScript chain
this needs is permissive end to end, so it can be depended on rather than paraphrased. And the
identity ladder has lost the rungs this document was counting on, in exactly the direction it
predicted, which puts the happy path on the authenticated branch and makes attestation something to
plan for rather than around. Each correction is made in place and says what it is correcting.
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

**The audio half is a URL that will not survive our contract.** `MusicProviderStream.resolveStreamUrl`
is specified to return "a complete URL that carries its own authentication, because the player
fetches it with no headers from us", and that last clause is where this breaks. A URL is obtainable.
It is bound to the client identity that minted it, so fetching it requires the matching
`User-Agent` and, for some client identities, `Origin` and `Referer`. Liquidsoap sends its own
headers and cannot be told otherwise per item. So the sidecar is unavoidable, but it is a header-
fixing proxy rather than a protocol implementation, which is a much smaller thing than it first
looks.

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
caller-supplied fetch implementation, which means catalog traffic can be routed through
`host.fetch` and stay inside the manifest's `permissions.network` allowlist rather than going around
it. Confirm that against whichever version gets pinned; it is the difference between an honest
manifest and a decorative one.

It is also actively maintained, which is the other half of that question and is answerable rather
than hopeful: v17.0.0 in March 2026, v18.0.0 on 2026-08-13, and the deciphering path refactored onto
AST-based extraction rather than pattern matching in v16. Pin a version, watch the releases, and
expect the pin to move on the upstream's schedule rather than ours.

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

That was read off the cookie's contents and is settled rather than inferred now: Google withdrew
OAuth for this service in late 2024, and every server-side implementation that works today
authenticates off a pasted cookie because there is nothing else on offer. There is no redirect flow
being held back for a later phase; there is no redirect flow.

`steer` is out too. There is no transport to drive.

## The audio half

### The state of the delivery protocol

The music client is now served over an adaptive segment protocol: not DASH or HLS, but a custom
framing addressed by player time and buffered ranges rather than byte ranges, which ffmpeg cannot
consume and neither can Liquidsoap (`yt-dlp/yt-dlp#13037`). Origin tokens are bound per video id, so
obtaining them means running the attestation continuously rather than passing a value by hand (a
process and not a container, which is worth reading below before pricing it), and there are reports
of the segment protocol being forced even with a valid token provider and a paid account
(`yt-dlp/yt-dlp#14390`).

**That is the state of the default path, and it is avoidable.** The identity a player announces
decides what it is served, and several identities are still handed ordinary adaptive formats with
signed URLs that answer a range request. Working desktop clients are built on exactly this: a
preferred identity for the authenticated case, and a ladder of alternates entered when the first one
is refused. So the question is not "how do we implement the segment protocol" but "how long does the
ladder keep holding", which is a maintenance question rather than an architectural one.

**The rungs named just above were too generous, and which ones they are matters more than how many.**
The original list read: a standalone-headset client, a TV client, a mobile client. Re-checked, the client
most downloaders leaned on for years was blocked at the upstream's CDN and removed from yt-dlp's
defaults outright (`yt-dlp/yt-dlp#15726`), and the headset client promoted into its place went
erratic within weeks, frequently answering with nothing but a single pre-muxed 360p stream
(`yt-dlp/yt-dlp#16150`). The TV clients and an embedded web client are what carry it now. **The
direction is the part to hold on to**: the rungs being closed are the ANONYMOUS ones, and the
authenticated branch this plugin was always going to be on is the one still standing. A pasted cookie
stopped being a compromise the catalog half forced on us and became the audio half's happy path too.

**And the protocol itself stopped being unimplementable, which moves the fallback rather than the
plan.** `LuanRT/googlevideo` is a TypeScript implementation of the UMP framing and the SABR session
under it: MIT, one runtime dependency, and by the author of the InnerTube client this document
already proposes to depend on. yt-dlp merged an official SABR downloader as well
(`yt-dlp/yt-dlp#13515`). Those are one fact from two directions, which is that the protocol is now
something several maintained projects speak rather than something only the upstream speaks. So the
third column of the table below is not a project any more. It is an import, and everything this
section says about avoiding the protocol is now a preference rather than a necessity.

### What a working client actually does, and what it costs us

The pattern, stated as mechanism rather than as anyone's design:

- **Deciphering is still required.** A format's URL comes out of the player response needing a
  signature transform computed from the session's player script. Any client library worth using does
  this; it is listed because it is the piece that breaks first when the player script changes.
- **A URL is bound to the identity that minted it.** Fetching it needs the matching `User-Agent`,
  plus `Origin` and `Referer` for some identities. **This is the single fact that forces a sidecar
  on us**, and it has nothing to do with the segment protocol. Even on the happiest path, the URL is
  not fetchable by Liquidsoap directly.
- **Visitor identity, or an origin token, depending on the rung, and the attestation is ours to run
  in-process.** The authenticated browser identity carries an origin token; the alternate identities
  carry visitor data extracted separately. This bullet used to hedge that only one of the two branches
  needs the attestation service, and that it is therefore "not necessarily a container we have to
  run". Both halves of that hedge resolve the same way now. `LuanRT/BgUtils` runs the attestation
  challenge in Node under MIT, so the token is minted in the plugin beside the resolve that needs it
  and no container is involved on either branch; and the branch that avoided attestation altogether is
  the branch going away. **Plan for attestation rather than around it.** The token binds to the video
  id, so it is minted per resolve and caches against nothing.
- **The URL carries its own expiry.** An `expire` query parameter, on the order of tens of minutes.
  Treat it as authoritative rather than assuming a fixed TTL.

Three defensive behaviours worth copying outright, because each of them is a bug we would otherwise
ship and diagnose from a listener's ears:

- **Probe before serving.** A `bytes=0-0` range request against the URL, with the response's content
  type checked and `text`/`json`/`xml` rejected, before the URL is handed to anything. An upstream
  that answers a refusal with a 200 and a JSON body is otherwise handed to the player as audio, and
  our own sharp edge (`stream-formats.md`: Liquidsoap picks a decoder from the extension and content
  type, and a bad one fails as **silence**) makes that the worst possible failure shape.
- **Cool down per format, not per track.** On a 403, 410, 429 or 5xx, record the failing format for
  a period and pick a different one, rather than retrying the same rejected format or giving up on
  the track.
- **Never silently substitute.** If a specific format was asked for and is unavailable, that is an
  answer, not a licence to serve something else.

### What the sidecar has to be

Given the above, three options, and they are no longer close:

| | Header-fixing proxy | Wrapper around a maintained downloader | Segment-protocol client on a library |
| --- | --- | --- | --- |
| What it does | forwards a range request upstream with the right identity headers | shells out per track, re-serves the result | speaks UMP/SABR through `googlevideo`, re-serves the result |
| Where resolution happens | in the plugin, in-process | in the sidecar | in the sidecar, because the session and the media fetch are one thing |
| Attestation | in-process, per resolve | the downloader's own token provider | in-process, per resolve |
| Size | small, and ours | medium, mostly glue | medium, mostly glue |
| Breaks when | the identity ladder stops working | the same, plus the wrapper's interface | the protocol moves under the library |

The third column's row for size read "large, permanent" and its row for what it does read "implements
the protocol". Both were written on the assumption that speaking the protocol meant implementing it,
which it no longer does, and that is the single biggest change to this document. Note what does NOT
move with it: a SABR session cannot be resolved in one place and fetched in another, because the
session IS the fetch, addressed by player time against what the client has already buffered. So that
column puts the media path in the sidecar by construction rather than by preference, and the "audio
never touches Node" note below applies to it exactly as it applies to the proxy.

**Build the proxy**, unchanged. Resolution stays in the plugin where the InnerTube client already
lives, the sidecar is a range-preserving reverse proxy that sets three headers and probes before it
serves, and `resolveStreamUrl` returns a signed URL pointing at it exactly the way the Spotify path
already does. What changed is the order behind it. The third column was written as the thing to reach
for only if the second stopped being maintained, on the assumption that it meant implementing a
protocol; it means importing one, and it breaks when the protocol moves rather than when the protocol
moves and a wrapper's interface moves. The second column keeps one real advantage, which is that
somebody else tracks the identity ladder daily and ships the fix into a release we pull. Treat the
two as siblings to choose between on the day, rather than as a descending ladder of desperation.

Two consequences of that choice. The proxy needs the upstream URL and the identity that minted it,
so it takes them as signed parameters rather than resolving anything itself, which keeps the
credential out of the sidecar entirely. And "audio never touches Node" stays intact on a technicality
worth stating: the proxy streams bytes, so if it is written in Node it is a Node process moving
audio. It is not the API process, which is what the rule is about, but it should be an argued
exception rather than an accident.

## What has to change in this tree

Ordered by how load-bearing it is, not by size.

**`host.trackFetcher` stops being singular.** `PluginHostFactory.createTrackFetcher` currently
checks the `trackFetcher` permission and then calls `SpotifyShimClient.serve` unconditionally. The
comment there is explicit that this is deliberate and that a second provider needing its own helper
is what earns the indirection. This is that provider. The minimum change is a lookup keyed by plugin
id, resolving to one of two clients; the SDK's `PluginTrackFetcher` interface does not change,
because it is already general.

**`TrackFetchSession` is the wrong shape, but this provider may not need it at all.** It is
`{ username, accessToken, expiresAt }`, one provider's credential model wearing a general name. With
resolution staying in the plugin, what crosses to the proxy is not a credential: it is an already-
signed upstream URL plus the identity string whose headers it has to be fetched with. Neither is a
secret and neither is the account. So either widen `TrackFetchRequest` to carry a
provider-defined opaque payload, or — cleaner — recognise that `host.trackFetcher` is the wrong seam
for this provider entirely and give the plugin a signed-URL minting capability instead, since all it
needs from the host is the bridge secret. Worth deciding before phase 2, because it changes whether
phase 2 is a refactor of the fetcher or an addition beside it.

**`ProviderStream.expiresAt` should carry the upstream's own expiry.** It is already on the
interface and documented as "unix epoch millis after which `url` must be re-resolved". The upstream
URL states its expiry in a query parameter; the proxy's signed URL should be minted no longer-lived
than that, rather than getting `SpotifyShimClient`'s flat 30-minute TTL. A URL that outlives its
upstream is an item that fails at the moment it airs.

**Nothing else, and that is the good news.** URL signing and the bridge secret already exist in
`SpotifyShimClient` and are provider-agnostic. `implementsStream` already requires both the
declaration and the method, so a plugin that declares only `catalog` is a supported state rather than
a broken one: the running order asks `asStreamPlugin`, gets `undefined`, skips the item and holds
nothing against the plugin. That is what makes the phasing below real rather than cosmetic.

## One availability trick worth having

A track can be refused for reasons that have nothing to do with our credentials — age gating being
the common one — while the same recording is served fine under a different id. Matching on title,
artist and duration within a few seconds finds it, and the check that makes this safe rather than
sloppy is the duration bound: a match within about five seconds is the same recording, and anything
looser is a different edit that would air as the wrong thing.

Cheap, and it fits our existing behaviour rather than fighting it. `resolveStreamUrl` returning
`undefined` already means "skip this item", so the fallback is a strictly better answer in the same
place. Not phase 1 work; note it against phase 4.

## Phases

Each stands alone as a commit and leaves the tree working.

1. **Catalog only.** `plugins/youtube-music` on `youtubei.js`, manifest declaring `capabilities:
   ['catalog']`, cookie as a `secret` config field, no `resolveStreamUrl` and no `trackFetcher`
   permission. Search and playlist import work in the console; nothing airs, by design. This is the
   phase that proves the credential model and the InnerTube client before any container work.
2. **Resolve without serving.** Add the format selection, deciphering and identity ladder to the
   plugin, reachable from a debug route or a test rather than from `resolveStreamUrl`, and assert it
   produces a URL that answers a `bytes=0-0` probe with an audio content type. **Assert the format is
   audio-only rather than merely audio-bearing**, which is the correction this phase most needed: the
   live failure mode is a rung that answers with nothing but one pre-muxed 360p stream
   (`yt-dlp/yt-dlp#16150`), and that passes "a URL with an audio content type" while being a video
   download at the wrong bitrate for a music station. Start the ladder at the TV clients and an
   embedded web client rather than at the mobile and headset rungs, and mint the token per resolve
   rather than expecting a rung that needs none. This is the phase that proves the ladder still holds
   before any container exists. **It is no longer the phase to abandon on**, which is what the arrival
   of a maintained protocol library changed: a ladder that does not hold means building the third
   column instead of the first, which is a different phase 3 rather than the end of the plan.
3. **The proxy.** A range-preserving reverse proxy in `stream/`, taking a signed upstream URL and an
   identity, probing before it serves, refusing non-media content types, cooling down failed formats.
   Verifiable with `curl` before any plugin knows about it. Whether it hangs off `host.trackFetcher`
   or a new signed-URL capability is settled here.
4. **Wire it up.** Add `resolveStreamUrl` returning a proxy URL whose expiry is the upstream's own,
   flip the manifest to `['catalog', 'stream']`, and add the same-recording fallback for refused
   items. This is the commit where tracks start airing.

## Who has already built this

Added 2026-08-25. Three implementations are worth reading before any of the above is written, and the
striking thing about them is that none is a radio station: this shape exists in music systems and in
chat bots, and nobody has put it behind a running order.

**A server-side music system with exactly this split.** Music Assistant's YouTube Music provider is
the same two halves separated the same way: an unofficial catalog client for search and playlists,
and an unrelated resolution path for audio. It resolves through yt-dlp, deciphers in a JavaScript
runtime it ships for the purpose, and runs the attestation as its own CONTAINER that the operator
points the provider at, pinned to a specific version. Cookie auth only, premium account required,
free accounts unsupported. Its documentation is unusually honest about what ownership feels like:
everything is best-effort, breakage is expected whenever the upstream changes, and the recovery story
is waiting for upstream to fix it and picking up the release. That is the second column of the table
above running in production, which is the strongest available evidence both that the column works and
what it costs to live in.

**The clearest reference for the ladder itself.** `lavalink-devs/youtube-source` maintains ten client
identities with fall-through on refusal, which is the mechanism described above written down as a
list somebody keeps current. MIT, so the definitions and the ordering are readable rather than
inferable, and it is explicit that a poToken applies only to the web clients and that neither it nor
OAuth is a silver bullet. Its issue tracker is the cheapest way to learn which rung broke this week,
and the entries run continuously through 2026: signature extraction failing against a changed player
script, individual clients demanding a login, all clients failing at once.

**The sidecar, already built by somebody else.** Invidious companion is a range-proxying service on
the same InnerTube client, maintaining PO tokens and re-serving `videoplayback` upstream, which is
the first column of the table as a deployed thing. Read it for the failure modes rather than for the
code: its tracker carries two this station would otherwise have discovered on air, an unhandled
rejection in the chunk-streaming path taking the process down and defeating its own retry, and a
proxied URL handed back naming the wrong host so that clients cannot fetch it. Its licence is
unchecked and the project's family is copyleft, so treat it as a design reference and not as a
dependency.

**Nothing in the radio-station shape exists.** Searched against Icecast and Liquidsoap, this turns up
hobby scripts shelling out to a downloader per track: no rotation, no caching, no audience gate,
nothing that has to keep a mount fed for a week. So there is no comparable to copy and no
comparable's outage history to learn from, which cuts both ways.

## Cost of ownership

The reason to write this section rather than only the phases: everything above is buildable, and the
question is whether it should be built.

This is the first dependency in the tree that is actively adversarial. Spotify's API is published
and versioned, and its shim speaks a protocol that changes rarely. This one changes on the upstream's
schedule, without notice, in a direction chosen specifically to stop what we are doing. A break here
is not a bug we introduced and not one we can fix on our own timetable: it is silence on a mount
until someone else ships a fix. The audience gate limits the damage — an unresolvable item is
skipped, not waited for — so the failure is a thinner rotation rather than dead air. But "thinner
rotation, cause upstream, ETA unknown" is a state the station will be in periodically and forever.

**The specific thing that will break is the identity ladder**, not our code. Every rung is a client
identity the upstream has not yet decided to serve differently, and the direction of travel is that
they get closed one at a time. That is worth knowing because it sets what "maintaining this" means:
not fixing bugs, but re-checking which identities still work and reordering a list. Small, frequent,
and impossible to schedule, and the tracker of any maintained client library is the cheapest place to
read the current state off rather than measuring it here.

This section then made that the phase-2 abandon condition, and that no longer follows. A ladder that
stops holding moves the work onto the segment protocol rather than ending it, and the protocol is a
maintained MIT dependency now. What abandonment would take is the ladder AND the protocol library
failing together, which is the upstream having decided to serve nobody but itself, and at that point
what is gone is the whole third-party ecosystem rather than this plugin.

Set against that, the thing it actually buys: material that is on no streaming service. Live sets,
sessions, uploads, mixes. If that is the reason, it is a good reason and the catalog half alone does
not deliver it: phase 1 without phase 4 is a search box that cannot play anything. If the reason is
instead "more catalog than Spotify has", this is a large permanent maintenance commitment for an
overlap that is mostly already covered.

There is also the licence question, which is a decision rather than an engineering problem and
belongs to the operator: this is a source with no published playback API and terms that do not
contemplate what the proxy does. It is a plugin an install can choose to run, not a thing to ship
enabled.

A second licence question, this one ours, and **this document had it wrong**. It said the client
implementations that work are copyleft, several of them AGPL, and concluded that everything here had
to be recorded as mechanism so it could be rebuilt from the description without lifting anyone's
code. That is true of the Invidious and NewPipe family and false of the JavaScript ecosystem, which
is permissive end to end:

| Library | What it covers | Licence |
| --- | --- | --- |
| `youtubei.js` | InnerTube client: catalog, player responses, deciphering | MIT |
| `LuanRT/googlevideo` | the UMP framing and the SABR session under it | MIT |
| `LuanRT/BgUtils` | the attestation challenge, minting origin tokens in Node | MIT |
| `lavalink-devs/youtube-source` | the identity ladder, kept current (Java, reference only) | MIT |
| `ytmusicapi` | the catalog half's shape (Python, reference only) | MIT |
| yt-dlp | everything, including the protocol | Unlicense, binaries GPLv3+ |

So the chain this plugin needs can be DEPENDED on rather than paraphrased, and that is a materially
different plan from the one above: the deciphering, the attestation and the segment protocol are
three imports rather than three things to reimplement from a description. The only care needed is
that yt-dlp's public-domain dedication covers its source and not its bundled binaries, which is a
distinction that matters if a wrapper is ever built.

The mechanism-not-code discipline is still worth keeping, for a reason that is not licensing. Probe
before serving, cool down per format, honour the URL's own expiry and bound a duration match at five
seconds are behaviours this station wants whichever library is underneath, and writing them down as
ours is what makes them survive the library being swapped out. That is a portability argument now
rather than a legal one, and it is the weaker of the two, so it binds the sidecar's behaviour and not
the choice of dependency.
