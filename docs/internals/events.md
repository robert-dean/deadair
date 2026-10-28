# Internals: event destinations

How the station tells an operator's own servers what happens on it: a signed POST per event to a
home automation hub, a workflow tool, or anything else that takes a webhook. The module is
`apps/api/src/modules/events`; its routes are `apps/api/data/contracts/events/events.ck`.

Every paragraph here records a decision and the obvious alternative it was chosen over. Read the
ones covering whatever you are about to change. The always-loaded index is
[`CLAUDE.md`](../../CLAUDE.md).

## Three words, kept apart

**An event is what happened; a destination is where it is sent; a webhook is the transport.** The
feature is "event destinations", not "webhooks", for two reasons. Today every destination is an HTTP
webhook, but the thing an operator configures is a destination, and naming it after its transport
would have to change the day a second one (MQTT, say) arrives. And "webhooks" is kept for the OTHER
direction: a platform pushing INTO the station, under `/webhooks/*`, which the audit middleware
already classifies as a webhook caller and which a route guard in
`tests/server/middleware/authorization.context.middleware.test.ts` keeps empty until something
verifies a vendor's signature. A route for this feature under `/webhooks/` would collide with both.

**None of this is `station_events`.** That table is the activity feed's record of a moment, written
as a sentence for a person. An event here is the same kind of moment written for a machine. Copy and
docs say "station events" for the feed and "event destinations" for this, and never a bare
"events" for either.

## Not a plugin, and not the messaging path

**A core module, because there is nothing for a plugin to own.** The chat plugins exist because each
platform has its own protocol; a webhook has one. A plugin also cannot be called with events, so the
host would still own the fan-out, the subscriptions and the routes, and the plugin would hold a list
of URLs and secrets as config fields, which is a table pretending not to be one.

**The shape of `MessagingAnnouncer`, not its code.** That path announces records only, as text, to
targets a plugin names. This one sends every kind of moment, as a typed envelope, to targets in its
own table. What it borrows is the pattern: listen on the edge, hand one job per destination to the
broker, and drop an event once it would be false rather than late.

## What goes on air, and when

**Off the transport's aired edge.** `EventAnnouncer` listens to `Rundown.onAired`, which fires once
per item at the moment listeners hear it, the edge play history, the scrobble and the chat
announcements hang off. That is what "a track changed" has to mean to a light in somebody's hall:
committed to the running order is minutes early, and a production's `production.aired` row is
written when it is PLACED, not heard. The rundown is in `playout`, before this module, so listening
needs nothing earlier to know `events` exists; this is not a `StationBus` arm, because the
transport's own seams stay off the bus (`apps/api/CLAUDE.md` § "How work is dispatched").

**Four types say what is on air at every moment** (`airedEvent`, pure, in `event.announcer.ts`):
`track.started` for a record, `programme.started` for a podcast episode or a reading,
`production.started` for a phone-in, a guest or banter, and `talk.started` for every other thing the
station says. A receiver that wants an On Air light turns it on for the middle two and off for the
others, and needs no "ended" event: what ends something is the next thing starting.

**A production fires once.** A station with no mixer airs a production as a block of beats, one item
each, and a phone-in announced seven times is seven claims that it started. The announcer remembers
the production the last item belonged to and stays quiet while it is the same one. Which production a
segment belongs to is read from `production_id` alone (`SegmentRepository.kindOf`), because the
joined row that usually airs has no ordinal and `toSegment` hides the production id without one.

**A segment whose row is gone sends nothing**, rather than a guessed kind a receiver would act on.

**Going on and off air comes over `StationBus`.** The director decides it and is registered long
before `events`, so it publishes `air.changed` beside its `air.on` and `air.off` feed lines, after
the durable write, and `EventAnnouncer` subscribes: the one case the bus exists for, a producer and
its subscriber on opposite sides of `modules.ts`. It becomes `station.onAir` or `station.offAir` with a
`reason` (`programme`, `resumed`, `stopped`, `ranOut`), true for ten minutes rather than an item's
length, and a state event like the four above, so a late retry of it cannot undo what came after. The
moment carried is when the director decided, not when the subscriber got round to it. **A stand-down
for a live show, and the resume when it ends, publish nothing**: a presenter is on the air through the
live input, so to a listener the station never went quiet, and a server told `station.offAir` would act
on something untrue. The activity feed still records both. Events of their own for a live show are a
follow-up rather than a new `reason`, because `offAir` with any reason still says the station is quiet.

**A request arriving comes over the bus too**, from `RequestDesk.submit`, for the same reason: the
desk is registered before `events`. It is published once the row is written and, when it could be,
placed, so `status` is what the listener is told, and a refusal is a request received like any
other. Not from `AfterCommit`, deliberately: the subscriber reads nothing back, and a request from a
chat is submitted in a scope no request middleware runs, where an after-commit task would never run
at all. `request.received` is NOT a state event (it says nothing about what is on air), so it is never
dropped as stale, and it stays worth sending for an hour.

**A dedication goes out in the listener's own words.** That is listener text leaving the station,
which the activity feed's rule ("never a third party's text") would refuse for the feed. It is
carried here because the receiver is the operator's own server and the words are what a dedication
is; nothing the station itself says is built from them.

## Late, stale, and switched off

**A delivery is an EVENT, not an attempt.** `events.deliver` is one job per destination per event,
retried by the broker three times from fifteen seconds with backoff: about two minutes, the length of
a hub restarting. `EventDeliverer` decides which attempt is the last, and only that one counts toward
switching a destination off, so a restart costs one failure per event that fell in the gap rather
than four. pg-boss gives a job no attempt counter, so the attempt number is read from the delivery log.

**Past its moment, an event is dropped.** `notAfter` is the item's end (`announceDeadline`, the chat
announcer's rule), and a light switched for a record that has finished is wrong rather than late. A
drop counts as a failure only if an attempt at that event had already failed.

**A stale state event is dropped too.** The broker keeps no order, so a retried `talk.started` can
finish after the `track.started` that followed it. `last_state_at` holds the newest moment a
destination has taken, moved forward with `greatest()` so two deliveries finishing in either order
leave the newer one, and an older state event is written down as dropped instead of being sent.

**Twenty failed deliveries in a row turn a destination off**, with one `warn` line on the activity
feed under the `events` module, written by whichever job crossed the line: the count is incremented
in the database, and `disableFailing` updates only a destination that is still on, so two jobs
crossing together say it once. Turning it back on clears the reason and the count, because an
operator doing that is saying the receiver is fixed and a count left at nineteen would switch it off
again on the first hiccup. A test delivery never touches the count: a test is a probe, not traffic.

## What a delivery is

**One envelope for every type** (`EventEnvelope` in `events.types.ck`): `id`, `type`, `occurredAt`,
`station`, `data`. A receiver reads `type` and then knows what `data` holds; `GET /events/types`
gives an example of each. JSON-safe because it is sent: times are ISO-8601 strings in UTC and every
duration inside `data` is integer milliseconds. `id` is minted once and kept across retries, so a
receiver can tell a redelivery from a second event.

**Signed with the scheme a ServerKit receiver verifies.** `WebhookSender` signs with servercore's
`signRequestBody`: the HMAC-SHA256 of `"<unix seconds>.<body>"`, prefixed `v1=`, in
`Deadair-Webhook-Signature`, with the seconds in `Deadair-Webhook-Timestamp` and the event id in
`Deadair-Webhook-Id`. The timestamp is what gives a receiver a replay window. A ServerKit receiver
verifies through `requireSignature` with the same `prefix` and a `timestamp` option, which is why the
signer lives upstream beside `DefaultSignaturePolicy` rather than here: the two halves cannot drift.
The headers name the transport, which is a webhook, and carry no vendor's prefix. The body is
serialized once and those exact bytes are signed and sent; re-serializing after signing is the
classic way to send a signature for a body nobody received.

**A home automation hub cannot check an HMAC**, and its webhook trigger is protected by the secret in
its URL instead. That is fine, and it is also why every route here is on `platform.manage`, reads
included: the address is often the whole of the receiver's protection.

**The secret is sealed, not hashed**, because every delivery signs with it. It is minted by the
station (`deadair_dest_` and 32 random bytes), shown in the clear on creation and on rotation and
never again, and stored encrypted with the root key on the party pass's rule. The two routes that
return one are kept out of MCP.

**Moving an address is guarded like minting a secret.** A destination keeps its secret when its
address changes, so a `PATCH` that repoints it hands every later event, still validly signed, to
whoever chose the new address. It was the one write left exposed: any `platform.manage` credential,
a connected app over MCP included, could redirect a destination without proving anything. So
creating, rotating and changing the address ask for a recent strong factor
(`StrongFactorGate.assertRecentIfAnyEnrolled`) in `EventDestinationsService`, and the patch is
`mcp: exclude` with the other two. The check fires only when the address actually moves, because
the console saves the whole form, and renaming, switching off or changing what one is sent moves
nothing anywhere.

## One attempt, and what the answer means

**`WebhookSender.send` makes one attempt and never throws.** Retrying belongs to whoever calls it,
because only the caller knows how long the event stays true. 2xx is delivered. 408, 429, every 5xx,
a refused connection and a missed deadline are worth asking again. Any other 4xx is not. The deadline
is five seconds to the status line, short because the receiver is on the LAN and answers in
milliseconds or is down, and the body is cancelled unread.

**The reason is the station's own sentence, never the receiver's body.** It is shown in the console
and kept in the delivery log, and a response body is somebody else's text: the line the activity
feed draws, applied outward.

## Egress: the LAN is allowed, a redirect is not

**A destination may be a private address**, and `privateAddressBehind` is deliberately not applied.
The address is an instruction from somebody holding `platform.manage`, the same standing a plugin's
`fromConfig` host and `PluginOperatorHosts` already have, and the receiver this exists for lives on
the operator's own network. Refusing private addresses would refuse the feature. Do not "fix" this.

**What a refusal WOULD have protected against is answered by never following a redirect.** A public
address is the risk: whatever answers there could redirect the station onto a machine beside it. So
`redirect: 'manual'`, and a 3xx is a permanent failure whose reason tells the operator to save the
address it moved to. Without a redirect there is nothing to re-check per hop, which is also why the
rebinding gap the plugin guard documents does not open here.

**`webhookUrlProblem` is the one rule for an address**, checked when it is saved and again before
each send: http or https, and no username or password in the URL, since an address is written into
the console and every log line that names it. A receiver that wants a token takes it in the path or
the query.

## The delivery log

**A short log per destination, not a queue.** `event_deliveries` holds every attempt, test
deliveries included, and nothing reads it to decide whether to send: retries are the job broker's.
It is kept to the newest fifty per destination, trimmed by the same call that writes a row, because
the moment a row arrives is the one moment the destination is known to have one too many, and a busy
station would otherwise write one row per record per destination forever.
`apps/api/scripts/events.smoke.ts` covers the trim, and the subscription match, the state mark and the
failure count, which are the parts that are SQL.

**A test is sent whether the destination is on or not**, because checking a receiver before turning
it on is the obvious thing to want, and it lands in the same log as real traffic so the console shows
both in one place.
