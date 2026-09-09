# Rich now-playing on a hardware player

**Written:** 2026-08-11, after asking whether a BluOS plugin could put artwork and split track fields
on a Bluesound player's display.
**Probed:** 2026-08-19, against a live NAD M10 V2 on BluOS 4.16.6 playing the station, and against
the BluOS Custom Integration API v1.7 (04/09/2025). That firmware post-dates BluOS's change of
Internet radio backend, so none of this is a measurement of the service it replaced; see the note
under the table.
**State of the tree:** the mount is labelled with one line of text and nothing else. Nothing in this
file exists, and after the probe nothing in it should.

**Verdict: closed. One line of per-track text, plus a station logo somebody sets once by hand.** The
three phases below are kept only so the reasoning survives; do not build them. What the probe
changed is WHICH fact closes it — the original guess was wrong about the blocker and right about the
outcome.

**Still closed, and the desktop app now drives one anyway, 2026-09-08.** `apps/desktop` grew a
plugin system whose only capability is an output target, and its first plugin plays the station on a
BluOS player. Nothing in this file reopens: the plugin routes the AUDIO and the player still shows
one line of ICY text. What it settles, measured on the same M10 on 4.16.22, is the one question this
file left open about the `/Play` slots — the caption and the image are offered as settings, off by
default, and documented as one-shot exactly as the probe found them. The measurements are in
`apps/desktop/CLAUDE.md` under `Plugins: BluOS`, including the correction that a player handed a
mount DOES report it as its `streamUrl`, which this file had never seen.

**Still closed for a HARDWARE player, and routed around for a phone, 2026-09-05.** `apps/android`
shows cover art and split title/artist/album fields, and gets none of it from the mount: it reads
`GET /nowplaying` beside the audio and pushes the result into a `MediaSession`, so the lock screen
and any Bluetooth head unit get the rich fields the ICY stream cannot carry. That is available to
anything that can run code alongside the stream, and to nothing that can only consume a URL — which
is what a BluOS player is, and why the verdict above is unchanged.

---

## The thing that was actually wanted

A hardware network player (the case in hand is BluOS: Bluesound, NAD, some Dali) added the station as
a custom stream URL, and showing what a paid service shows on it: cover art, and title, artist and
album as separate fields rather than one string.

The station already labels the mount. `itemAnnotations` in
[annotate.ts](../../apps/api/src/modules/playout/annotate.ts) puts `title`, `artist` and `album` on
every pushed uri, and `PlayoutPusher.announce` re-labels mid-track through `POST /control/metadata`
([liquidsoap.control.ts](../../apps/api/src/modules/playout/liquidsoap.control.ts)). So a player
added by URL is not showing nothing; it is showing what ICY can carry.

## Why the stream cannot carry the rest, on any player

Already measured and written down in `annotate.ts`: **Icecast composes ONE `StreamTitle` out of the
title/artist pair and reports it flattened**, on both 2.4.4 and 2.5.0. There is no separate artist
field on the wire and no album field, and ICY has no concept of an image at all. Confirmed again
during the probe, on the live mount with the M10 connected:

```
"display-title": "2Pac, Roger, Dr. Dre - California Love - Original Version"
"title":         "2Pac, Roger, Dr. Dre - California Love - Original Version"
```

So the ceiling for a custom-URL station is one line of text, on every player, permanently. It is not
a BluOS limitation and no amount of work on the stream side raises it.

Two things that look like a second path and are not:

- **A different mount format.** `stream-formats.md` covers Opus/AAC/FLAC, and Ogg's in-band comment
  tags are a real second metadata channel — but they carry the same fields, still no image, and that
  file already records that clients split roughly in half over whether they read them at all.
- **Icecast's admin metadata API.** Same fields, same flattening, plus a second credential. The
  annotation path was chosen over it deliberately; see the note in `annotate.ts`.

## What the player actually does with that one line

Measured on the M10 V2, added as a custom station and therefore filed under TuneIn
(`service=TuneIn`, `serviceType=RadioService`, `streamUrl=TuneIn:https://…/live.mp3`):

| Field | Value | Source |
| --- | --- | --- |
| `title1` | `Deadair` | Icecast `server_name` |
| `title2` | `Snow - Informer` | the whole flattened ICY `StreamTitle`, verbatim |
| `title3` | absent | — |
| `image` | absent on 2026-08-19, **present on 2026-08-20** | the SERVICE, not the stream. See below |

It does **not** split on the dash, which was the worry worth having: the station's own labels carry
more than one `" - "` (`2Pac, Roger, Dr. Dre - California Love - Original Version`), and a player
that split on it would have produced a confidently wrong artist. It does not try.

### That `service=TuneIn` is not stale, and the firmware date is why

BluOS replaced the Internet radio backend behind its directory in **4.14.9 (2026-02-24)**, three
months before the **4.16.6 (2026-05-19)** this was probed on. So the reading above is already a
post-change measurement, and the fact it records is that **a station added as a custom stream URL is
still filed under `service=TuneIn` after the change**. That is consistent rather than surprising: the
new backend is what the controller app BROWSES, and a URL typed in by hand is not browsed. The slot
naming is a client-side label on a stream this station serves directly, which is why nothing in the
table depends on who supplies the directory.

What a directory change COULD reach is a station listed in that directory and added from its entry,
which is a different thing entirely and one deadair does not have: the station is in no directory. If
it is ever submitted to one, the entry's own artwork and name are the directory's fields rather than
the stream's, and that is the only path by which anything in this file reopens. **It is also the
only reason to re-probe** — a firmware bump alone is not, since three of these findings
(`/Play`'s undocumented parameters, the reconnect, the sticky slots) are reverse-engineered surface
and the spec-level ones are not.

Written down because the timeline was re-derived once from the release date alone and came out
backwards: 4.16.6 reads older than 4.14.9 if the version is compared as a decimal.

### The image slot is filled by the DIRECTORY, and it is currently a placeholder

Re-read 2026-08-20, live, same player (NAD M10 V2 `Office`, **BluOS 4.16.6, byte-identical firmware
to the probe the day before**) and same custom-URL station:

```
image>http://cdn-radiotime-logos.tunein.com/s0q.png   service>TuneIn   serviceType>RadioService
stationImage>http://cdn-radiotime-logos.tunein.com/s0q.png             streamFormat>MP3 128 kb/s
title1>Deadair   title2>Warren G, Nate Dogg - Regulate   secs>692   state>stream
```

`image` and `stationImage` are populated, which the August table recorded as absent, and **neither
comes from the stream**. Fetched, `s0q.png` is a 145×145 grey placeholder mark: it is the service's
own "this station has no logo" image, `s0` being a station id that is no station. So the slot is not
empty and never was reachable from our side — **the service fills it out of its directory, for a
station the operator typed in as a URL, by matching that URL against entries it holds.** deadair
matches nothing, so it gets the placeholder.

That is the single actionable finding in this file, and it is not the feature the file is about:
**listing the station in that directory would put a real logo in this slot, with no reconnect, no
`/Play`, no preset and no code.** It is a cheaper route to the same static logo the section below
recommends a hand-added preset for, and unlike the preset it survives the station being added on a
device the operator never touched. It buys a STATION LOGO and nothing else — the slot is per
connection and per station, so it is still not cover art, still not a field, and the verdict is
unchanged.

Two things it corrects rather than adds. The August reading of `image` as absent was true of an
unlisted station and was written down as though it were true of the slot, which is why the file
concluded the only way to fill it was a reconnect: there was a third way the whole time and the probe
could not see it, because a placeholder had not yet been served. And the note above is now half
wrong in the useful direction — a directory listing does not merely reopen this for a station added
FROM the directory, it reaches a station added by URL as well.

Unmeasured, and worth knowing before anyone acts on it: whether the slot refreshes without a
reconnect when the directory entry changes (assume not, it is almost certainly read at connect), and
whether a listing would also take `title1` away from Icecast's `server_name`.

### The version number moved on nothing, which is the lesson

The firmware on both readings is **4.16.6**. Not a bump, not a controller-app update, not a change on
our side: the stream, the mount, the ICY line and the way the station was added are all the same, and
a slot that was empty one day held a service-supplied image the next. **The thing that changed is the
DIRECTORY, which carries no version this file can read and ships whenever it likes.**

So the claim two sections up that a firmware bump is not a reason to re-probe was right for the wrong
reason and is too narrow. The reverse-engineered surface here has **two** suppliers, and only one of
them has a version number. What follows is not to re-probe more often, which would find nothing most
days, but to distrust an ABSENCE: every "absent" in the table above is a measurement of what the
directory served that afternoon for a station it does not have, and none of them is a statement about
what the slot can hold. The presences are the durable half.

## The unknown the design hung on, and its answer

**Can a BluOS player's now-playing display be updated mid-stream, without re-issuing playback?**

**Yes for the text, and the original file guessed this wrong.** Long-polling `/Status` across three
boundaries, `secs` climbed 3630 → 3776 unbroken with `state` never leaving `stream`, while `title2`
flipped within seconds of each item:

```
08:26:14  secs>3660  title2>Tasmin Archer - Sleeping Satellite
08:26:26  secs>3672  title2>John Anderson - Straight Tequila Night
08:27:12  secs>3718  title2>Talk break: Straight Tequila Night into My Boo - Hitman's Club Mix
08:27:40  secs>3746  title2>Ghost Town DJs - My Boo - Hitman's Club Mix
```

So the feared failure — a re-buffer per boundary — is not what closes this. The line updates in
place, for free, and it already works with no code on our side. The player even pushes the change
rather than making us poll for it (an etag long-poll returns early on a boundary).

**No for anything else, and that is what closes it.** `/Play?url=…&image=…&title1=…&service=Custom`
was tried against the live player. The fields ARE accepted and echoed back — but:

```
BEFORE:  secs>4056  service>TuneIn  state>stream     title1>Deadair
AFTER:   secs>0     service>https   state>connecting title1>Ghost Town DJs
                    image>https://radio.example.com/art.jpg
```

`secs` reset to zero, `state` went to `connecting`, the station was re-filed from TuneIn to a raw
`https` stream, and **the operator heard the break in the audio**. It is a reconnect. At a boundary
every three minutes that is not a feature, it is a fault with a nice display.

**But the pushed fields are STICKY, and that is the one thing here worth remembering.** Read again
260 seconds and several records later, still on the raw `https` path:

```
image>https://radio.example.com/art.jpg  secs>260  state>stream
title1>Ghost Town DJs                       title2>Dwight Yoakam - Suspicious Minds
```

So the slots divide: **`title1` and `image` are one-shot, set by `/Play` and held until the next
one; `title2` belongs to ICY and updates in place.** (`title3` was pushed as `Deadair` and did not
survive at all.) Artwork therefore costs ONE reconnect, not one per boundary — which is a real
correction to the first reading of this probe, and still does not rescue the feature, because what
that buys is a STATIC image and a STATIC first line. A station logo, not cover art. Making art
follow the record puts a `/Play` on every boundary and the reconnect comes straight back.

**And the slots can only be written by a `/Play` that establishes a NEW connection.** Issued against
the URL already playing, `/Play` is inert in both directions — `secs` kept climbing (33 → 38, no
reconnect) and `title1` and `image` did not move, still unchanged 269 seconds later. So there is not
even a cheap way to refresh the caption without the reconnect, which closes the last hole: the
reconnect is not the price of a NICER update path, it is the only path. (Note for anyone repeating
this: the reconnect a URL change causes can take minutes to land, so a probe that samples five
seconds afterwards will read the OLD connection and conclude the opposite.)

It is worse than merely insufficient, too: a sticky `title1` goes stale by design. Four minutes
after the push the amp was captioning a Dwight Yoakam record with `Ghost Town DJs`, which is the
station confidently saying something false — the same failure `docs/decisions`-wide reasoning about
forward claims exists to prevent, arriving through a display instead of a sentence.

## Three things in the published spec that make it worse than a cost question

Read against **BluOS Custom Integration API v1.7**, which is the whole documented surface:

1. **There is no metadata-push endpoint anywhere in it.** The thirteen sections are status queries,
   volume, playback control, queue management, presets, browsing/search, grouping, reboot, doorbell
   chimes, direct input, Bluetooth and the LSDP discovery appendix. Nothing writes now-playing.
2. **The `/Play` parameters we used are undocumented.** The spec lists exactly `seek`, `id`, `url`,
   `inputIndex` and `inputTypeIndex`. `image`, `title1`, `title2`, `title3` and `service` are not in
   it. They work on 4.16.6; they are a reverse-engineered surface on a device that takes firmware
   updates, which is the precise risk the first draft of this file flagged and could not test.
3. **The split-fields half of the ask is refused by design, not by limitation.** On `title1`, the
   spec says the three lines "MUST be used as the text of any UI that displays three lines of
   now-playing metadata. Do not use values such as album, artist and name." BluOS's display model is
   LINES, not FIELDS. Even paying the reconnect does not buy an artist field and an album field; it
   buys three lines whose text you chose. The thing that was wanted does not exist on this platform
   for anybody, including the paid services it was being compared against.

`/Sources` 404s and `/Presets` came back empty, so there is no third surface either.

## The one thing that IS available, and it needs no code

A static station logo. There are two ways to get it and they land in the same place:

- **A preset.** Spec v1.7 added an `image` attribute to presets (§6.1), so adding the station as a
  preset rather than a custom URL puts a logo on the display. The spec is explicit that "presets
  must be added and deleted using the BluOS Controller app", so this is the operator's job and not
  something to automate. It wants a name and an absolute image URL; the station's is
  `https://radio.example.com/logo.png`, which is `apps/web/public/logo.png` reaching the edge
  through nginx's SPA root, 512×512 and publicly fetchable. Worth knowing if that ever 404s: the
  console's built assets are what nginx serves, so the file has to be in `dist`, and a probe from
  outside a browser may be answered 403 by the edge while a real client gets 200.
- **One `/Play?url=…&image=…&title1=…`.** As measured above, both slots stick. It costs one
  reconnect and reaches the same result programmatically.

The preset is the better of the two for the same reason the whole file closes: it is documented, it
survives a firmware update, it costs no reconnect, and it does not leave a `title1` that will be
wrong about every record after the first. Prefer it.

That is the entire deliverable this idea ever had: a station logo, added by hand, once.

## The three phases, and why they are not being built

Kept for the record. Each was sound given the guess this file was written on:

1. **A display capability in the plugin SDK.** Dead: there is no field to write that ICY is not
   already filling, so the interface would have no content.
2. **The host-side consumer.** Dead with it.
3. **The BluOS plugin itself.** Dead with it.

The supporting observations still hold and are worth keeping, because the next device to raise this
question will need them:

- **This is not a music-provider plugin.** The device is neither a catalog nor a stream source. It is
  a display sink, and `packages/plugin-sdk/src/capabilities/` has no capability of that shape.
  `steer` is the nearest neighbour and is wrong twice over: its five methods are `enqueue` / `play` /
  `pause` / `skip` / `getPlaybackState`, none of which is "here is what is airing, show it", and
  nothing in `apps/api/src` calls it at all.
- **Plugins cannot subscribe.** `PluginHost` is call-in only; `host.events.emit` goes outward and
  there is no inbound event. A plugin cannot notice a track boundary by itself, so the host would
  have to call it at the seam that already labels the mount: `Rundown.onAired`, subscribed by
  `PlayoutPusher` ([playout.pusher.ts](../../apps/api/src/modules/playout/playout.pusher.ts)).
  Whatever labels the mount should label the device, from the one event, so the two can never
  disagree.
- **The art half was already solved and stays solved.** `GET /art/{id}` is `security: none`
  ([art.ck](../../apps/api/data/contracts/art/art.ck)) because an `<img>` carries no bearer token,
  and the store holds a local copy rather than hotlinking a CDN. A device on the LAN can fetch it
  as-is. The M10 accepted an `image` URL and held it across boundaries. The slot it went into is
  one-shot and station-wide, so what was missing was never a way to serve art — it was a per-record
  place to put it.
- **BluOS answers XML**, so a plugin would have needed its own parser. Never reached.

## What the probe turned up that is not about displays

At 08:27:12 the amp's screen read `Talk break: Straight Tequila Night into My Boo - Hitman's Club
Mix`. That is `labelFor` in
[talk.break.writer.ts](../../apps/api/src/modules/director/talk.break.writer.ts), whose docstring
said a label is "for a console and a player's display" — so it was deliberate, and it was producer
language (`Talk break:`, `Back-announce:`, `Intro:`) reaching the audience. Given that the one line
of text is now known to be the entire ceiling, what that line SAYS during a break is the only
remaining lever on a hardware player's display, and it was spending it on internal vocabulary.

**Fixed.** `listenerTitle` in [annotate.ts](../../apps/api/src/modules/playout/annotate.ts) is the
boundary: a break is the station talking, so the mount carries `stream.title` and a record is left
alone. Both routes to the mount go through it — the annotation that rides the boundary and
`PlayoutPusher.announce`'s mid-track re-label — or a break handed over as the station's name and
re-announced as `Talk break: …` would put the paperwork straight back.

## Related

[listening-loop.md](listening-loop.md) §1 for making the mount reachable in the first place, which
this assumed and did not provide. [stream-formats.md](stream-formats.md) for the mounts and the ICY
toggle a hardware player would care about. [from-v1.md](from-v1.md) for the previous station's
now-playing sinks, which are the same idea pointed at a service rather than a device — and which,
unlike a device, can take fields.
