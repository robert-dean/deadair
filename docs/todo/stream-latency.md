# How far behind the live edge the station is, and what it would cost to close

**Written:** 2026-08-11, after the console monitor reported 2.3s and the question was whether that
number is a knob.
**State of the tree:** one `%mp3` mount, burst 8192 B, `proxy_buffering off`, and a console monitor
that measures its own buffer and reports it. Nothing else in this file exists.

**Status: optional.** This is not on the near-term order in [README.md](README.md) and should not be
pulled onto it. It is written down because the reasoning was done once and should not be done again,
and because there is one specific future feature that would make it necessary rather than nice. Read
it when that feature comes up, or when the lag starts costing something an operator can name.

---

## A different thing this file gets asked about: the stream DROPS on a phone

**Not latency, and not fixable with any of the knobs below.** Reported 2026-08-28: playing
`/live.mp3` on a phone, moving between wifi and mobile drops the connection and needs a manual
reconnect.

An Icecast mount is one long-lived TCP connection. The handoff changes the phone's source address,
so the socket is dead by definition — the far end is talking to an address that no longer exists.
Nothing on the server side carries a TCP connection across that, no Icecast setting touches it, and
none of the buffering below is involved. A player that reconnects itself hides it; most do not.

**The fix shipped, and it is a different transport rather than a setting.** HLS is a sequence of
ordinary HTTP requests for small files, so the same handoff costs at most one segment fetch and the
player asks again. It is `stream.hlsEnabled`, and it lands 6-12s behind the live edge with the
default two-second segments — worse than the mount on every axis this file cares about, and the
right answer anyway for a listener who moves. See
[stream-formats.md](stream-formats.md).

So the two are complements: the mounts for a listener who stays put and wants to be close to live,
HLS for one who does not. Do not read the latency numbers below as an argument against it.

---

## What the 2.3s is, and what it is not

`StreamMonitor` reported `buffered.end - currentTime` — audio the BROWSER
has received and not yet played. **The component is gone**: the console deliberately does not play
the mount, which [playout.md](../internals/playout.md) records. The measurement below is kept
because it is about what such a number can and cannot mean, not about the component. It excludes the encoder and Icecast entirely, which is what its own
tooltip says. So it is a reading of one browser's media buffer, not of end-to-end lag, and the true
end-to-end figure is that number plus a term nobody has measured.

The server side is already close to its floor:

| Term | Where | Size |
| --- | --- | --- |
| Icecast burst | `burst-size` 8192 B, [icecast.xml.tmpl](../../stream/icecast.xml.tmpl) | ~0.5s at 128 kbps |
| nginx | `proxy_buffering off`, [snippets/icecast.conf](../../nginx/snippets/icecast.conf) | none |
| Liquidsoap | no `buffer()` in [radio.liq](../../stream/radio.liq), frame duration left at the 0.04s default | small |

That accounts for well under a second of the 2.3. The rest is almost certainly the browser deciding
how much MP3 it wants in hand before it starts an `<audio src=…>`, which then becomes a permanent
offset because the element plays at 1x from wherever it began. The monitor's own doc comment already
explains why speeding up to drain it does not work and was reverted.

**A correction this raises, unverified.** The comment at
[icecast.xml.tmpl](../../stream/icecast.xml.tmpl) says the burst is backlog a listener keeps for the
whole session. That is true for a player that starts on the first decodable frame (a command-line
player, a hardware radio). It is NOT obviously true for a browser with a fill threshold, where the
burst arrives instantly and only makes STARTUP faster while the steady-state offset stays whatever
the threshold is. If that is right, the burst costs real listeners latency and costs the console
monitor none.

### The one cheap diagnostic, not yet run

Set `burst-size` to 0, restart Icecast, reconnect the monitor.

- Reading stays ~2.3s: it is the browser's threshold, no server knob will help, and the comment above
  needs correcting.
- Reading drops to ~1.8s: the burst is real backlog for browsers too and the model above is wrong.

Worth doing before anything in this file is designed against, because it decides whether the problem
is even server-side.

## Three ways to close it

| Approach | Realistic browser latency | Verdict |
| --- | --- | --- |
| Server-side tuning | ~2.3s, i.e. no change | Already at its floor. Do not spend a change here. |
| Console monitor plays its own buffer | ~300ms | Cheap. One file. Console only. |
| A second, real-time transport | ~150-400ms | A container and five collisions. Only for two-way audio. |

An intermediate segmented-HTTP transport (low-latency HLS) is deliberately absent from that table.
Sub-second is quoted for it, but that assumes tuned partial segments and a cooperative CDN; through a
browser player library against a self-hosted origin it lands roughly where the tree already is. It is
not worth a container to arrive back at 2.3s.

### Option 2, the cheap one

Stop using `<audio src>` in the monitor. Fetch the mount, decode the chunks through the Web Audio
API, and schedule playback against a buffer the console chooses (~200-300ms). The console owns the
latency instead of asking the browser for it.

Cost: the console is now an MP3 streaming player, and underruns become its problem rather than the
browser's. Confined to one component, and it changes nothing any listener hears.

### Option 3, the real-time transport

Real-time here means WebRTC. Liquidsoap cannot speak it, so it is a media server as a sibling
container beside Icecast, fed off the same `bus`:

```
bus → %ffmpeg(opus) → [RTP | SRT | WHIP] → media server → WHEP → browser
```

Architecturally this is consistent with everything already here: another sibling container, no
decoding in Node, the same shape the compose file has for Icecast and Liquidsoap. The problems are
elsewhere.

**Check first, unverified:** the pinned `savonet/liquidsoap:v2.4.5` image is ffmpeg-backed, so
`output.url` with `%ffmpeg` can push RTP or SRT today. Whether that build carries the `whip` muxer
(ffmpeg 7.1+) decides whether Liquidsoap can address the endpoint directly or whether a transcode
relay has to sit in between. That is one output line versus a second process, so establish it before
designing.

### What option 3 collides with in this tree

Mostly not the audio. In rough order of how expensive each is to discover late:

1. **The audience gate would silently mute the station.** `AudienceWatch` learns the listener count
   from Icecast three ways: the stats poll (`listenersForMount`), the SSE event feed, and the
   `listener_add` / `listener_remove` hooks into `POST /playout/listener`. A WebRTC session is none of
   them. In `audience` mode, which is the default, a station whose only listener is on the real-time
   path counts zero, `gateOpen()` goes false, `PlayoutPusher` stops renewing the lease, and
   [radio.liq](../../stream/radio.liq) gates to `blank()`. The listener receives a very low-latency
   stream of silence. **The media server must report its session count into the same watch as a fourth
   input**, and that is the piece this whole file exists to write down.
2. **Metadata has no channel.** Now-playing reaches listeners as ICY, inserted onto `radio` by
   `control_metadata`. WebRTC carries no equivalent. The console does not care, since it renders
   now-playing from the app already, but any public real-time player needs its own feed. The app
   knows what started, because `PLAYOUT_AIRED_URL` tells it, so this is a surface rather than a
   question.
3. **Opus means the resample [stream-formats.md](stream-formats.md) already priced.** Real-time is
   Opus in practice, Opus mandates 48 kHz, the bus is 44.1. Building the planned Opus mount first
   pays part of this, which is an argument for that ordering rather than against this.
4. **UDP does not go through the nginx location block.** `/live.mp3` proxies because it is HTTP. The
   media server needs its own UDP range published from compose, and anything off the LAN needs a
   relay for hosts behind NAT. On a single personal install behind a home router this is the part
   most likely to end the attempt, and it is not code.
5. **Standing cost.** A container, per-listener connection state, and a second encoder running
   continuously whether or not anyone connects. That last one is exactly the objection
   stream-formats.md raises against unused mounts, and here it is paid twice.

## The recommendation, and the thing that would change it

**Do not build option 3 for the monitor.** Option 2 reaches ~300ms by changing one component; option
3 reaches ~200ms by adding a container, a codec path, a signalling surface, a NAT story and a fourth
input to the audience gate.

Option 3 only earns its keep when LISTENERS need real time, and radio listeners have nothing to
synchronise against. Nobody is comparing the mount to a live event. Latency is an operator's problem
here, felt at the skip button, and it is confined to one browser.

**The case that would flip this is two-way audio**: a call-in, or the real microphone that
[radio.liq](../../stream/radio.liq) already names as the honest reason to bring a live harbor input
back. The moment somebody remote has to hear the station and respond into it, a 2.3s round trip is
unusable and no amount of buffer tuning helps. If that is ever built, build the real-time transport
with it, take the five collisions above as its known cost, and the console monitor inherits the
latency for nothing.

Note also that none of this touches DJ cue timing, which is already immune: voice and bed are mixed
BEFORE the encoder, so whatever separates the decoder from the listener applies to both and cancels.
[radio.liq](../../stream/radio.liq) says so where `on_air_elapsed` is declared. Nothing in this file
is a correctness problem, which is most of why it is optional.
