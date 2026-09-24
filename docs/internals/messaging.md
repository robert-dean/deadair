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

## Commands, and nothing a model reads

**The station acts only on commands**: a leading `/`, a name from a closed table, and whatever
follows (`messaging.commands.ts`). In a group chat everything else is ignored, including a command
the table does not know, since another bot in the same group may answer to it. In a direct chat
anything else gets the list of what the station answers to, because somebody writing one to one is
writing to the station. Telegram's `/start`, which it sends the first time anybody opens a bot, is
answered with the same list.

**What people write is untrusted, and here it reaches nothing that could be steered by it.** It is
matched against the table and otherwise dropped. Anything later that carries a listener's words
further (a request, a dedication read on air) treats them as quoted data: never in
`station_events.detail` or a `BreakRequest.reason`, which are the station's own words.

**Which chats count is the plugin's decision**, because chat ids are the platform's vocabulary.
Anything `receive` returns is something the host acts on.
