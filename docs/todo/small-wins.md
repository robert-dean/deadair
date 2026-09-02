# Deferred: three small ones, none of which is a day's work

**Written:** 2026-08-28, promoted out of [comparable-stations.md](comparable-stations.md)'s ranked
list, where they sat as entry 8 — "the small ones, in any order". They are here as one file rather
than three because what they have in common is the only thing worth saying about them together: each
is small, each is independent of the other two, and each has been costed against the real tree rather
than guessed at. Anything that grows past that should leave this file and get its own.

## A second scrobble destination

**Cheaper than it looks, and the reason is that most of it is already built for something else.**
The `scrobble` capability, `deadair.scrobble_queue` and the send-after-commit design all exist. Only
`plugins/lastfm` implements the capability — and `plugins/musicbrainz` already carries a ListenBrainz
client, its types, and its entry on the host's network allowlist, because enrichment needed them.

So the work is a manifest capability and a submit call, against a client that is already here and
already trusted.

**The one rule: the two destinations must fail independently.** A queue that drains to both and
retries the pair on one failure will double-submit to whichever succeeded, and a listening history is
exactly the kind of thing nobody notices is wrong until it is very wrong. Whether that is a row per
destination or a per-destination cursor on one row is the whole of the design question.

## `.pls` and `.m3u` endpoints

Two static text routes naming the mount. Hardware players, car receivers and most desktop players
take a playlist file rather than a stream URL, and typing a URL into a car is not a thing anybody
does.

**This was pointless while the mount was on the LAN and stopped being pointless when it went behind a
tunnel** ([listening-loop.md](listening-loop.md)). That is the whole of why it is on the list: the
work did not change and the reason for it appeared.

Both files are a handful of lines built from `STREAM_KEYS.publicUrl` and `STREAM_KEYS.mount`, which
the settings registry already holds and the console already edits. **They are public, so they name
the public URL and never the compose service name** — the one way to get this wrong is to build them
from `icecastHost`, which is the internal address and is right for Liquidsoap and wrong for everybody
else.

## An MCP surface

The other station serves one over HTTP off its own API, split into unauthenticated reads and admin
actions.

Here the contracts already generate a typed client, so the mechanical cost is low. **What it actually
costs is a decision this tree has deferred once already:** which verbs an outside agent may reach and
how it authenticates. That is [service-actors.md](service-actors.md)'s question wearing a different
hat — the station currently has one shared bridge secret and no actor kind for a non-human caller,
and an MCP surface is a second non-human caller with a much wider reach than Liquidsoap's.

**So this one is not small until `service-actors.md` lands, and putting it in this file is arguably
wrong.** It is here because that is where the ranked list left it, and because the correction is
worth recording: the mechanism is small and the authorization is not, and an MCP surface built before
the actor model would be a hole with a typed client in front of it.

## A listener cap as a setting

`stream/icecast.xml.tmpl` hardcodes `<clients>100</clients>`. `STREAM_KEYS` has no entry for it and
`stream.config.ts` sizes the queue and the burst from the bitrate but not the client count. The
fifth pass of [comparable-stations.md](comparable-stations.md) called this the only thing both absent
and arguably wanted now that the mount is public behind a tunnel, and the seventh pass found it had
never been written down anywhere it would be built from. One `STREAM_KEYS` entry and one template
substitution; the config watch already restarts Icecast when the rendered file changes, so nothing
else moves.
