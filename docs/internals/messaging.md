# Internals: the station on chat platforms

How people reach the station from Telegram, Slack, Discord and the like: the `messaging`
capability, the poller that listens, and the commands it answers. The capability's contract is
`packages/plugin-sdk/src/capabilities/messaging.ts`; this is the host side of it.

Every paragraph here records a decision and the obvious alternative it was chosen over. Read the
ones covering whatever you are about to change. The always-loaded index is
[`CLAUDE.md`](../../CLAUDE.md). The designs this grows toward are Ideas
[#54](https://github.com/robert-dean/deadair/discussions/54) (requests through a chat bot) and
[#76](https://github.com/robert-dean/deadair/discussions/76) (arbitrating them).

## The station pulls, because a plugin cannot push

**A plugin has no inbound HTTP and no way to call into the station**, so incoming messages are
pulled. `MessagingPoller` (`apps/api/src/modules/messaging/messaging.poller.ts`) runs one worker per
active `messaging` plugin, each asking `receive({ cursor, waitMs })` in a loop, one call at a time.
The plugin turns that into whatever its platform has: Telegram's `getUpdates` offset, a Slack
timestamp, a Discord snowflake. A platform that can only deliver by webhook (WhatsApp's Cloud API)
does not fit yet; it would need a host-owned route under a prefix middleware in the shape of
`bridge.secret.middleware.ts` and a plugin method to verify the platform's signature.

**A loop and not a pg-boss cron**, which is the usual home for work nobody waits on, because here
somebody is waiting: a person who typed `/now` expects an answer in seconds and the broker's cron
runs by the minute.

**The cursor is a row, `deadair.messaging_cursors`, saved after the batch it covers was answered.**
A restart resumes rather than replaying a week of commands or skipping what arrived while the station
was down. Saved after rather than before, so a crash in between answers a batch twice rather than
losing one: a repeated answer is the cheaper mistake. The cursor is opaque and the host never reads
it. No cursor at all means "from now", never "everything the platform still holds".

**Recovery is the plugin breaker's, not the poller's.** A worker ends on its own when its plugin is
not `active`: uninstalled, mid-reinit after a config save, or quarantined after three failed polls.
A supervisor looks every ten seconds for an active platform with no worker and starts one, so the
breaker's own recovery probe is what brings a platform back. Between failures that do not trip the
breaker the worker backs off from five seconds to five minutes.

**Stopping never waits out a long poll.** A poll can be held open for 25 seconds, and the call is
abandoned rather than awaited when the poller stops, or every shutdown would be that much longer.
The plugin's own disposal cancels what it still has open. The module sits late in `modules.ts` for the
same reason: it tears down before the director and long before the plugins it polls.

## Announcing what airs

**Off the transport's aired edge, not the director's.** `MessagingAnnouncer` subscribes to
`Rundown.onAired`, which fires once per item at the moment it is heard, the same edge play history
and the scrobble hang off. The director calling forward into this module would be the dependency
`modules.ts` exists to rule out, since messaging registers after it; the rundown is in `playout`,
before both. Records only: a break is the station talking, and a programme names itself.

**A pg-boss job per chat, not a table and a cron.** The scrobble queue is a table because a play
sent a day late is still a play. An announcement is the opposite: "now playing" posted after the
record has finished is false, not late. So `messaging.announce` carries a `notAfter` (the record's
end, or four minutes when its length is unknown, never less than one), drops itself once past it,
and otherwise leaves retries to the broker (three, from fifteen seconds, with backoff). A refusal the
plugin calls permanent is logged and dropped; one it calls retryable throws, which is the retry. One
job per chat, so a channel that removed the bot costs no other chat its message.

**Which chats is the plugin's answer**, through `announceTargets()`, asked on every record so a
config change takes effect on the next one.

## Commands, and nothing a model reads

**The station acts only on commands**: a leading `/`, a name from a closed table, and whatever
follows (`messaging.commands.ts`). In a group chat everything else is ignored, including a command
the table does not know, since another bot in the same group may answer to it. In a direct chat
anything else gets the list of what the station answers to, because somebody writing one to one is
writing to the station. Telegram's `/start`, which it sends the first time anybody opens a bot, is
answered with the same list.

**The table is ServerKit's `comms` `ChannelRouter`** (`@maroonedsoftware/comms`), with each platform a
channel named by its plugin id: commands by name, button presses by action id, the rest to one
message handler, and what nothing claims to the fallback. A handler answers through a `Reply` bound to
the chat (`messaging.reply.ts`), threaded under the message in a group and not one to one. A button
about one thing among several carries it as the action's `value`, since the router matches an action
id exactly. Templates render in their portable form; no plugin takes a native payload yet.

**What people write is untrusted, and here it reaches nothing that could be steered by it.** It is
matched against the table and otherwise dropped. Anything later that carries a listener's words
further (a request, a dedication read on air) treats them as quoted data: never in
`station_events.detail` or a `BreakRequest.reason`, which are the station's own words.

**Which chats count is the plugin's decision**, because chat ids are the platform's vocabulary.
Anything `receive` returns is something the host acts on.

## Who a chat account is

**Anybody in a chat the station listens in is a listener, and needs nothing.** Operator commands
(`/skip`, `/offair`, `/onair`) need a **linked** chat account: a signed-in operator asks the console
for a one-time code (Settings, Sign-in and security, Chat accounts) and sends `/link CODE` to the bot
one to one. `messaging_identities` then maps the platform's user id to the station account. There is
no new actor kind, which keeps [#33](https://github.com/robert-dean/deadair/discussions/33) unbuilt.

**The link proves an account; the permission is read fresh on every command.**
`MessagingOperator` checks the account is still active and still holds `platform:manage` each time,
from the tuples, the way a request resolves its roles, so a demotion or a deactivation takes effect
on the next command. The verb then runs through `PlayoutService`, the service behind the console's
own buttons, in a scope whose `AuthorizationContext` is that user: what the console would refuse,
this refuses.

**Codes are hashed, single-use, ten minutes, one live per account, and burned if seen in a group.**
Only the SHA-256 is stored. Consuming one is a single `delete ... returning`, so two chats racing the
same code cannot both win. A code sent to a group has been read by everybody there, so it is used up
on the spot and the sender is told to get another. Minting a code refuses an API key, for
`ApiKeysService`'s reason: a key must not hand a chat account its owner's powers.

## Requests

**A request is an API first and a chat command second.** `apps/api/data/contracts/requests/requests.ck`
is what a listener app calls (`platform.view`: search, ask, follow your own) and what the console decides
with (`platform.manage`: list, grant, decline), so the Android, iOS and desktop SDKs have it without any of
this module knowing they exist. A chat's `/request` reaches the same `RequestDesk.submit`, so one person
cannot get round the rules by asking from the other side.

**The arbitration is a pure function**, `request.arbiter.ts`, because it is the part that is policy:
[#76](https://github.com/robert-dean/deadair/discussions/76) says the design problem is arbitration, not
intake. One open request per person (the key is the account, or the platform's user id), a cooldown after
one is let through (a refusal does not count against anybody), a cap on how many are open at once, and
never the same record twice. Every refusal is a sentence the station says to the person asking, and a
refusal is still a row (`declined`, with its `reason`), so an app is answered in the same breath.

**The station's own rules still hold.** A request goes through `PickResolver` with the broadcast's rules,
as a mixed-in record does, so a dislike, the repeat window, the period and the advisory policy apply to it.
The search a listener picks from stands on the same floor as the model's (playable, not disliked).

**Placed by the director, and only with its bytes here.** `insertRequested` puts the record in the first
quiet gap near the head (see `director.md`), never beside another request. A record whose audio is not local
is fetched (`playout.cache_track`) and the request waits `pending`; so does one that found no gap. The
`requests.tick` cron offers pending requests again every minute and lets go of any not placed within the
hour, or placed and not heard within three. The aired edge (`RequestAiredWatch`, on `Rundown.onAired`)
marks a request heard by its RECORD, since the rundown's items do not carry the request id.

**An operator may approve every request** (`requests.approval`), in which case each waits as `waiting`
until granted or declined through the routes. A declined request's `reason` is the station's words or the
operator's, never the listener's.

**Nobody's email address is shown or read out.** An app request carries the name the listener chose, or
"a listener"; a chat one, the name the platform shows.

**`/request` in a chat searches, and asks at once only for a clear match** (the only one, or an exact
title); several are offered as up to three buttons, `request.pick` with the record's id as the value, and a
press is looked up rather than trusted, since a client can send any value. A chat account LINKED to a
station account asks as that account, so the one-at-a-time rule and the cooldown are one person's whether
they ask from the app or the chat (`messaging.requests.ts`).

**Somebody who asked from a chat is told what became of it** through the `messaging.announce` job, by
name, since the messaging module registers after this one. They are told only things that happen LATER
(placed after a wait, granted, declined by an operator, aired, lapsed): the command that took the request
already answered with its outcome.

## Dedications

**A dedication is the listener's words, and every part of the station treats them that way.** Who it is
for and a short message ride the request (`dedicate_to`, `message`), tidied of control, zero-width and bidi
characters and held to the contract's lengths (`request.dedication.ts`), shown to the operator as theirs,
and never put in `reason`, the activity feed, or a listener label: the player's metadata says
"Dedication", not a name somebody typed.

**The words are planted in front of the record, not requested as a break.** When a dedicated request is
placed, the desk plans a `dedication` segment and the same `insertRequested` edit puts it directly before
the record, in the same quiet gap. It is written when its slot comes near like any planted break, and its
writers name the record after it (`claimsNext`), so the claim check drops the words at hand-over if
anything ever comes between them. A refused placement writes the planned segment off rather than leaving
it looking like a break to come. `requests.dedications` off plays the record without the words.

**Two writers, and only one of them touches the message.** `DedicationWriter`, the floor, names who it is
from and who it is for and never reads the message, because a template cannot judge whether it is fit to
broadcast. `ModelDedicationWriter` passes the message on in its own words: the names and the message reach
the prompt fenced between `<<<` and `>>>` (with those characters taken out of the text, so it cannot close
its own fence), described as what a listener typed and never as instructions, with an instruction to drop
anything unkind, crude, promotional or unfit. The prompt alone is not trusted: an answer that repeats five
of the message's words in a row is refused (`quotesListener`) and falls to the floor, so the worst a
hostile message does is cost itself the paraphrase. For a station that wants a person in the loop,
`requests.approval` puts every request, and its dedication, in front of an operator first.

**From a chat, `/request <record> for <name>: <message>`.** Only with a colon, since " for " is in too many
titles; the last " for " before the colon splits the record from the name. A dedication survives a "which
one did you mean" choice, held in memory for ten minutes against the sender (not the chat), so pressing
somebody else's button in a group takes the record and not their words.

