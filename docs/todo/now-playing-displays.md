# Rich now-playing on a hardware player

**Written:** 2026-08-11, after asking whether a BluOS plugin could put artwork and split track fields
on a Bluesound player's display.
**State of the tree:** the mount is labelled with one line of text and nothing else. Nothing in this
file exists.

---

## The thing that is actually wanted

A hardware network player (the case in hand is BluOS: Bluesound, NAD, some Dali) added the station as
a custom stream URL, and showing what a paid service shows on it: cover art, and title, artist and
album as separate fields rather than one string.

The station already labels the mount. `itemAnnotations` in
[annotate.ts](../../apps/api/src/modules/playout/annotate.ts) puts `title`, `artist` and `album` on
every pushed uri, and `PlayoutPusher.announce` re-labels mid-track through `POST /control/metadata`
([liquidsoap.control.ts](../../apps/api/src/modules/playout/liquidsoap.control.ts)). So a player
added by URL is not showing nothing; it is showing what ICY can carry.

## Why the stream cannot carry the rest, on any player

This is the load-bearing fact, and it is already measured and written down in `annotate.ts`:
**Icecast composes ONE `StreamTitle` out of the title/artist pair and reports it flattened**, on both
2.4.4 and 2.5.0. There is no separate artist field on the wire and no album field, and ICY has no
concept of an image at all.

So the ceiling for a custom-URL station is one line of text, on every player, permanently. It is not
a BluOS limitation and no amount of work on the stream side raises it. Anything richer has to reach
the device by a second path.

Two things that look like that second path and are not:

- **A different mount format.** `stream-formats.md` covers Opus/AAC/FLAC, and Ogg's in-band comment
  tags are a real second metadata channel — but they carry the same fields, still no image, and that
  file already records that clients split roughly in half over whether they read them at all.
- **Icecast's admin metadata API.** Same fields, same flattening, plus a second credential. The
  annotation path was chosen over it deliberately; see the note in `annotate.ts`.

## The shape that fits

Point the player at the mount as now, and push the display separately over the player's own LAN
control API on every track boundary. Audio comes off Icecast; only labels and an artwork URL travel
over the second path.

**The art half is already solved.** `GET /art/{id}` is `security: none`
([art.ck](../../apps/api/data/contracts/art/art.ck)) because an `<img>` carries no bearer token, and
the store holds a local copy rather than hotlinking a CDN. A device on the LAN can fetch it as-is.
The stable-URL rule in the plugin SDK README (§7) is what makes those URLs safe to hand to a device
that caches them.

## What is missing on our side

**This is not a music-provider plugin.** The device is neither a catalog nor a stream source. It is a
display sink, and `packages/plugin-sdk/src/capabilities/` has no capability of that shape. `steer` is
the nearest neighbour and is wrong twice over: its five methods are `enqueue` / `play` / `pause` /
`skip` / `getPlaybackState`, none of which is "here is what is airing, show it", and nothing in
`apps/api/src` calls it at all — `PluginTrackResolver`
([plugin.resolver.ts](../../apps/api/src/modules/playout/providers/plugin.resolver.ts)) is playout's
only plugin consumer and it asks nothing but `resolveStreamUrl`.

**Plugins cannot subscribe.** `PluginHost` is call-in only; `host.events.emit` goes outward and there
is no inbound event. A plugin therefore cannot notice a track boundary by itself, so the host has to
call it, at the same seam that already labels the mount: `Rundown.onAired`, subscribed by
`PlayoutPusher` ([playout.pusher.ts](../../apps/api/src/modules/playout/playout.pusher.ts)). Whatever
labels the mount should label the device, from the one event, so the two can never disagree.

**The device's address is operator-supplied.** Discovery is mDNS, which is ambient I/O the host does
not broker, so it is typed in like Navidrome's `baseUrl` — `{ fromConfig: 'baseUrl' }` in
`permissions.network`, which is exactly [navidrome.manifest.ts](../../plugins/navidrome/src/navidrome.manifest.ts)'s
pattern. Plain `http:` and a non-standard port both pass `host.fetch`; only the hostname is checked.

**BluOS answers XML.** `jsonBody` is no help and the plugin needs its own parser. Not a blocker —
plugins are trusted in-process (`docs/decisions/plugin-trust.md`) — but it would be the first plugin
here to need one.

## The unknown that decides whether this is worth building

**Can a BluOS player's now-playing display be updated mid-stream, without re-issuing playback?**

Its control API is reverse-engineered and version-dependent, and the answer is not something to take
on trust from memory. If the display can be updated in place, this is a modest feature. If the only
way to change it is to re-issue play, every track boundary costs a re-buffer and the whole idea is
dead — at which point the honest answer to the original question is "one line of text, and that is
what the format gives you".

**So the first step is a probe against a real player, not code.** Point it at the mount, poll its
status endpoint across a track change to see what it reports and what it renders, then try pushing a
display update and see whether the audio survives. That is a curl session, and it answers the only
question the design hangs on.

## If the probe says yes

Three phases, one commit each, each leaving the tree working:

1. **A display capability in the plugin SDK.** The interface, its manifest entry, and its registry
   coverage — no consumer and no plugin yet. Widening `steer` instead is the wrong call: it means
   "you own the audio", and this device does not.
2. **The host-side consumer.** `PlayoutPusher` fans the `onAired` item out to every plugin declaring
   the capability, best-effort and never blocking the boundary, exactly as `announce` already is.
   Off-air and silence get the same treatment `label_when_off_air` gives the mount, or a device sits
   showing a track that ended an hour ago.
3. **The BluOS plugin itself.** Address, XML parsing, and the mapping from a rundown item to the
   device's display fields.

Order matters in the usual direction: the seam first, the consumer second, the plugin last.

## Related

[listening-loop.md](listening-loop.md) §1 for making the mount reachable in the first place, which
this assumes and does not provide. [stream-formats.md](stream-formats.md) for the mounts and the ICY
toggle a hardware player would care about. [from-v1.md](from-v1.md) for the previous station's
now-playing sinks, which are the same idea pointed at a service rather than a device.
