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
duration, because that is the only way to learn about the next segment — so a playlist request IS a heartbeat,
and `HlsAudience` is the register of who has ticked inside the last fifteen seconds. That is not the
access-log counting this file refuses below: a log is a record of what happened, and this is a reading of what
is true now, so zero here means nobody rather than "could not tell". `AudienceWatch` keeps the Icecast total
and the HLS count apart and re-adds them in `recount`, so neither source can overwrite the other, and an HLS
arrival deliberately does NOT stamp `lastReadAt` — it is evidence somebody is there and no evidence whatever
about Icecast.

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
