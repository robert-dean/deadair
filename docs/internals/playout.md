# Internals: getting it on air

The lease over the mount, the audience gate above it, why the station is quiet, and the two surfaces
that report what happened.

Every paragraph here records a measured failure and the fix that was chosen over the obvious one.
Read the ones covering whatever you are about to change. The always-loaded index is
[`CLAUDE.md`](../../CLAUDE.md).

## The lease, and the audience above it

**The mount is leased, not held.** `radio.liq` airs nothing unless the app is actively renewing a
short claim (`POST /control/onair`, `CONTROL_TTL_S`, default 6s), and `PlayoutPusher` renews it on
its reconcile only while `Rundown.hasProgramme()` **and** `AudienceWatch.gateOpen()`. So a crashed,
redeployed or freshly restarted API takes the station off air within seconds instead of leaving
Liquidsoap's local music bed playing to nobody's plan, and "Stop" means out of service rather than
fall back to the bed. Anything that grows a second way to drive playout has to renew the lease too,
or it will be silently muted. Do not write docs or comments claiming the mount is never silent: it
is silent exactly when deadair is not driving it, which is the point. See `stream/README.md`.

**The audience is the second half of that lease.** `playout.airMode` in `deadair.settings` is `audience` (the
default) or `always`; in `audience` mode the station airs only while somebody is connected, so a loaded
station with a full running order and no listeners is silent **on purpose**, and the console says `ready` for
it. The count is polled from Icecast, which is the truth, off whichever stats endpoint that Icecast has:
`/admin/publicstats.json` on the 2.5.0 the compose file runs (read as the admin user, since access under
`/admin/` is a role decision an operator can tighten) or `/status-json.xsl` on a 2.4 (which 2.5 deprecates).
Whichever answers is cached, so the other is probed once per re-probe rather than once per poll.

**The two documents carry the same facts in different shapes, and neither matches what upstream's source
suggests** — `listenersByMount` is where that lives, and `docs/todo/icecast-2.5.md` records both measured
payloads.

**The audience is a SUM over every mount, plus the HLS listeners, and neither half is optional.** The station
publishes MP3 always and Opus, AAC and FLAC as the operator switches them on, so counting one mount would take
an audience-gated station off the air with somebody demonstrably listening to another. `IcecastStatsClient`
holds the per-mount breakdown and both halves write into it: the poll replaces the whole map, the event feed
replaces one entry through `noteMountCount` and is handed back the new total. Last writer wins per mount,
because both are authoritative totals for that mount at the moment they were produced rather than deltas to
reconcile. The reconciliation is deliberately not in the feed — a message names one mount and the gate wants
the audience, so a feed summing only what it had happened to hear about would publish a total omitting every
listener on a mount no message had mentioned yet.

**An HLS listener is counted differently because there is nothing to ask.** They hold no connection open, so
Icecast knows nothing about them. What a live player does instead is re-fetch the media playlist every target
duration, because that is the only way to learn about the next segment — so a playlist request that was
SERVED is a heartbeat, and `HlsAudience` is the register of who has ticked inside the last fifteen seconds.
The tick is recorded after the handler and only above a 400, because it used to be recorded on the way in on
nothing but the path: with HLS switched off and every playlist deleted, a client polling the URL still counted
as a listener and still held the gate open, so the station aired a full programme for somebody it was handing
404s to. The switch itself had the same shape of bug — `getHlsPlaylist` served whatever was on the volume, and
nothing deletes what Liquidsoap already wrote, so turning HLS off stopped it being PRODUCED and not being
SERVED; it reads `stream.hlsEnabled` now. That is not the
access-log counting this file refuses below: a log is a record of what happened, and this is a reading of what
is true now, so zero here means nobody rather than "could not tell". `AudienceWatch` keeps the Icecast total
and the HLS count apart and re-adds them in `recount`, so neither source can overwrite the other, and an HLS
arrival deliberately does NOT stamp `lastReadAt` — it is evidence somebody is there and no evidence whatever
about Icecast.

**The operator can say "not that one", and `stream.hlsRefuseAgents` is how.** A space-separated list of
product tokens from a player's user agent; anything matching is answered 403 in
`hls.heartbeat.middleware` before the handler, and so is never served and never counted. It exists because
the register cannot tell a person from a program and neither can anything else here — measured on the live
station, one client on the operator's own network pulled the MP3 variant continuously under two user agents
(a Go fetcher and the ffmpeg reader it handed the URL to) and held an `audience`-gated station on air around
the clock for nobody. That is not a counting bug to fix; it is a judgement only the operator can make, since
the same user agent is a robot on one station and somebody's hi-fi on another. A SETTING rather than an
nginx rule deliberately: the edge would need a rebuild and a recreate to change and would be invisible from
the settings page, where whoever is wondering why their new player gets nothing is already standing. What
that costs is the segments, which nginx serves and the app never sees — a refused player keeps the names its
last playlist gave it and stalls within one window, because a live playlist is the only way to learn the next
ones. `hls.refusal.ts` carries the whole argument.

**Any page may read the stream, and it took a JavaScript player to notice that one could not.** Native
playback is not a CORS request: an `<audio src>` fetches the playlist in no-cors mode and the browser applies
no origin check, so Safari, hardware players and the console's own preview all worked while every embedded
player was refused. hls.js and everything built on it read the playlist over XHR instead, because they parse
it and drive Media Source Extensions themselves, and an XHR IS origin-checked. Measured from a third-party
player page: 200, `Vary: Origin`, and no `Access-Control-Allow-Origin`, which fails on the FIRST request and
reports nothing more useful than a broken stream. It could not be another entry in the credentialed allowlist
the console needs — credentialed CORS forbids `*` — so `hls.cors.middleware` overrides the global answer for
this prefix on the way out and strips `Access-Control-Allow-Credentials`, which is not tidying: `*` beside
credentials is refused outright, so leaving it would have broken the one origin that used to work. It is set
in THREE places because three things answer for this output: the app for the playlists, the segments location
for the files nginx serves itself, and the root `.m3u8` REDIRECT, since a cross-origin fetch applies the check
to every response in a redirect chain and `/live.m3u8` is the URL the station hands out.

**That register is keyed on address plus user agent, so it is only ever as good as the address the edge
reports.** nginx sets `X-Real-IP` to `$remote_addr` and `clientKey` reads it through `clientAddress`, which
means that behind a tunnel or a reverse proxy every listener arrives as the SAME address and the key collapses
to the user agent alone. Measured on a live station reached through a tunnel: one client was counted as two
listeners, because a Go program fetched the playlist and then handed the URL to an ffmpeg reader that fetched
it again under a second user agent — and two people using the same player would have been counted as one. The
undercount `clientKey` documents is the acceptable direction; this is both directions at once. The fix is
`REAL_IP_FROM` at the edge rather than anything here (see `docs/internals/deployment.md`), because the app
cannot tell a proxy's address from a listener's and nginx can be told. The same address keys the rate limiter,
which is the more serious half: without it the whole internet shares one bucket.

## What the player fetches, and who else may

**The audio the player pulls is on a signed URL, and the routes that serve it are gated by
`signed.audio.middleware` rather than by a policy.** Liquidsoap fetches a segment, a stored take and
the station's own copy of a record with a headerless GET from another container (`request.create`
in `radio.liq`), the mixer and the analysis sidecar fetch the same routes the same way, and none of
them can hold a session or present the bridge secret in a header. So the three routes are
`security: none` in the contract for the reason the bridge's are, and the URL carries what a header
cannot: a token over the PATH with an expiry, cut with the bridge secret in the same shape as the
shim's track URLs (`playout.audio.token.ts`), put there by `AudioUrlSigner` at the five places a URL
is handed to a player. The console fetches the same routes through the SDK with its bearer, and the
middleware holds that call to the read floor exactly as the generated route would have. For a long
time the routes were simply open, on the argument that the mount broadcasts the same audio to
anyone; the mount is a mixed, ducked broadcast and `/playout/audio/{sourceId}` was the full-length
file, fetched from the provider through the operator's credentials for whoever asked. An hour's TTL,
because a cue's URL is armed when the record it rides is pushed and fetched when the cue fires. A
new anonymous audio route goes on the middleware's list, and its test reads the contracts to check
that nothing `security: none` in `render.ck` or `playout.ck` is outside the list or the bridge.

## Knowing who is listening

**The FEED is the mechanism and the poll is the failsafe.** `IcecastEventFeed` holds `/admin/eventfeed` open
and `icecast.eventfeed.parse.ts` deliberately does not filter on the trigger, so it takes the count off
whichever event carries one — and `source-listeners-changed` is emitted on every change in either direction
(`src/source.c`), with an authoritative total, reaching the feed with no `<event-bindings>` config because
`event.c` hands every event to the stream unconditionally. So both edges arrive within milliseconds and
`AUDIENCE_POLL_MS` is a minute, covering only what the feed cannot: a 2.4 server, a dropped feed, and the
window before the poll that discovers the admin endpoint has attached it.

**Icecast's `listener_add`/`listener_remove` hooks are GONE** along with `listener.credential.middleware`,
`stream.listenerHooks` and `POST /playout/bridge/listener`: they existed to beat a five-second poll to an
arrival, which the feed now does without holding a listener's own connection open on a blocking auth call to
this app — and with them went the property that a dead API refuses new listeners at the door.
`AUDIENCE_LINGER_MS` is five minutes and means only what it says now, since it is no longer cover for a missed
departure: how long the mount is held for somebody who might come back, at the cost of five minutes of
fetching per departure.

**Only a positive reading can close the gate** — a failed poll calls `settle()` without touching the count —
which is why there is no longer an `audienceUnknown` check: it reported a `fault` saying the station "stays
silent either way", true only when the last answer happened to have been zero. Off air the transport hands
over NOTHING and the falling edge calls `/control/offair` at once, because Liquidsoap keeps consuming the
playout queue whether or not `driving()` selects it (measured: `remainingMs` falls with the wall clock while
`driving` is false). Anything left queued plays out to an empty mount at a download per track, which is the
cost the gate exists to avoid. A warm queue is therefore not available from the app side; it would take a
clock change in `radio.liq`.

**The console does not play the mount**, deliberately: it used to carry a `StreamMonitor`, and the console is
the wrong place to listen to a radio station. The consequence is worth knowing rather than working around — an
operator with the console open is no longer an audience, so in `audience` mode a station with nobody actually
tuned in stays silent while they watch it, which is the gate telling the truth rather than a fault.

**Zero listeners and an Icecast that stopped answering are the same number and opposite facts.**
`IcecastStatsClient.listeners()` returns `undefined` for "could not read" and documents that as deliberately
not `0`; `AudienceWatch` used to discard it, so a dead stats endpoint read as an empty room and in `audience`
mode the gate then never reopened — silent for good, console saying `ready`. `AudienceWatch.reading()` keeps
`readAt` beside the count, stamped in `accept()` because that is the one place a poll and an event-feed
message meet, and both are proof Icecast is alive.

**The gate itself is deliberately unchanged**: an app that cannot see Icecast has no evidence anybody is
there, and airing on a failed request would be the worse mistake. What that means in practice is that only a
POSITIVE reading moves it — a failed poll leaves the last count standing rather than reading as an empty room
— so an Icecast that dies while somebody is listening does not take the station off air.

**A listener CLIENT is subject to all of this, and the consequences are worth stating once.**
Connecting to a mount is what puts an audience-gated station on air, so the first seconds after a
client presses play are warm-up — the lease, the first record, the encoder — and a client that shows
them as an error, or as a spinner that never resolves, is misreporting the station's ordinary
behaviour. It follows that a client must never PROBE the mounts to discover which formats exist: a
connection, however brief, is an audience for the full linger, so a settings screen built that way
would put a silent station on air for five minutes. `GET /nowplaying` carries `mounts[]` for exactly
this reason, and it is the only thing a client should read for it. HLS listeners are counted from
playlist re-fetches keyed on IP and User-Agent, so a client should send ONE stable agent from all of
its requests — audio, API and artwork — or it will be counted as several listeners, or as none.
`apps/android` is the worked example.

**A client that hands playback to a network player is producing a SECOND listener, and must transfer
rather than add.** `apps/desktop` can send the station to a BluOS speaker, and from this side that
speaker is an ordinary anonymous listener with its own address and its own agent — so a moment with
both the app and the speaker connected is the station serving two audiences for one person, and on an
audience-gated station it then holds the mount for the full linger after the one nobody is at.
The rule the desktop app enforces is that the local player stops and drops its connection BEFORE the
device is asked to play, and that a device is really stopped when the app stops or quits: a speaker
left streaming is a listener this station keeps counting with nothing left to end it. On HLS it is
also the two-agents-one-client double count measured above, arriving deliberately rather than by
accident.

## Why it is quiet

**Every gate that can silence the station says so, in ONE ordered answer.** `silence.diagnosis.ts` is eleven
gates over a `StationFacts` snapshot, pure so the precedence can be tested without a stack, and
`PlayoutStatus.silence` carries the verdict on the reading the console already polls — so the badge, the strip
and the `/onair` panel read one answer instead of the three partial inferences they each used to derive.

**The ordering is causal**: a stalled reconcile loop ranks above `streamUp` and `driving` because both are set
by calls that loop makes, so a stopped loop leaves them frozen at whatever they last said and nothing below it
can be trusted. Three rules keep it honest. `waiting` is its own state rather than a mild fault, because a
station idling for want of a listener and one that cannot reach its stream are both silent and only one wants
fixing — the same argument the `ready` badge exists on. `configNotAdopted` is reported and **never the
cause**, since a station can air perfectly well to somebody who connected before the config was replaced. And
`notDriving` is the RESIDUE: dropping the lease is what the dead-man switch and the audience gate are FOR, so
it is a fault only when nothing above accounts for it. `warmingUp` is the newest and sits just above
`waitingOnAudio`, splitting a state that had to describe both a station downloading its first records and one
whose provider had stopped answering — it never escalates, because it cannot last: when the fetches stop the
count falls to zero and the check below it takes over with its own clock. It is also the one gate that must
outrank `airing` on a technicality, since `hasProgramme` is true of a queued holding message and the station
would otherwise report itself as broadcasting its show while looping "give us a moment". Nothing is stored;
the one database read is `station_air`, because whether an operator stood the station down is the only fact
not in memory. A cause CHANGE is logged on the edge, keyed like `StreamConfigWatch`'s warnings, and it is
written to `deadair.station_events` on the same edge, which is what makes "why was the station quiet at 3am"
answerable at all.

## What happened

**The activity feed is a union of three tables and owns only one of them.** `GET /activity` reads
`deadair.station_events` (the station's own moments: a silence cause changing, an air toggle, a gap that
outlived the loop meant to close it), `segment_events` (a break's journey, written since migration 0008
precisely so a feed could be a transport over rows that exist) and `play_history` (what aired).

**Neither of the two existing tables is copied**, because a fact with two writers is two things that can
disagree and no reader can tell which one lied; `script_history` is not a fourth source either, since a break
already appears through its segment rows and one row per write ATTEMPT would report one break as four lines.
Three rules hold it up.

**Producers write on EDGES**: the console polls the transport twice a second, so a row per reading would make
this a log file with a primary key, which is also why the ordinary sub-second first-listener gap is kept out
entirely and only a recovery long enough to have mattered is recorded.

**`ActivityRecorder` never throws** and every caller `void`s it, because nothing reads a row here to decide
anything and a failed insert must never cost the station the thing it was describing.

And **the sentences are written outside the SQL** (`activity.feed.ts`), because two of the three sources hold
facts that were never phrased for a reader and composing them inside a `union all` would put station copy
where nobody would find it. The cursor is a keyset over `(created_at, id)` rather than an offset: rows arrive
at the head continuously, and the id is half of it because a stand-down and the poll behind it land in the
same millisecond. `apps/api/scripts/activity.smoke.ts` is what covers the union, since the interesting part is
SQL.

**What writes to it, and the two rules learned by running it.** Beyond the transport's own edges
(`silence.cause`, `gap`) the producers are the director (`air.on`/`air.off`, `order.caughtUp`, `item.skipped`,
`break.claimStale`, `set.generated`), the render path (`break.degraded`, `production.unplanned` — a programme
whose outline the model could not write TWICE, which degrades to what a `quick` production does by design and
had been doing so in silence for 8 of this station's 12 productions), the catalog (`binding.benched`,
`track.discovered`) and the two operator surfaces (`order.*`, `airMode.set`, `plugin.*`), which are the only
ones that stamp `station_events.actor_id`.

**A catch-up is ONE event carrying a count, not one per item.** `StationLineup.markAiring` answers how many it
passed over because that number exists nowhere else, and the first version of the feed reported only the
narrow case — a break not ready when its slot came round — so a dropped stream wrote off twenty committed
items in silence. Twenty rows would have been the opposite mistake.

**The feed carries the station's own sentences and never a third party's text**: nothing here is redacted,
which is safe only while every `detail` is written by app code, so an upstream body, a provider's response or
a plugin's message must be summarized rather than quoted. That is also the line between this and `PluginLog`,
which scrubs tokens and sits on `platform.manage` precisely because plugin output goes through it.

**A heartbeat is not a health check.** `modules/shared/heartbeat.ts` is a map of name to two
timestamps and holds no opinion about thresholds, because a five-second poll and a nightly sweep are
both healthy and no one number describes both: it answers how long it has been and the reader
decides. `register` keeps boot from being a special case, so a loop is measurable from its first
millisecond without every caller inventing a grace window. A FAILURE stays beside the loop
(`PlayoutPusher.lastFailure`), because a loop that threw and came round again is still alive and
folding the two together leaves a reader unable to tell a loop that stopped from one failing every
pass. The beat is skipped for a pass that threw and taken for one that returned early — the several
`return`s in `reconcile` are the loop working. Two of the five timer loops have adopted it; the rest
are one line each on the day something reads them.
