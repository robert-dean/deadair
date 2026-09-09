# The stream server as a choice, and what the alternatives actually are

**Written:** 2026-08-18, when the question was whether the operator could pick a stream server
instead of getting Icecast.
**State of the tree:** one `libretime/icecast:2.5.0` container, one `%mp3` mount, the audience read
off `/admin/publicstats.json` and `/admin/eventfeed`. Nothing in this file is built.

**Status: not on the near-term order.** This is written down because the survey was done once, and
because the two facts that decide it are measured rather than guessed and should not have to be
re-fetched. The recommendation at the bottom is to keep Icecast.

---

## What Icecast is actually doing here

Naming a replacement is easy and useless without this list, because the four jobs have wildly
different replaceability and only one of them is hard.

1. **Accepting the source connection.** `output.icecast` in [radio.liq](../../stream/radio.liq),
   host, port, mount and password all out of `radio.env`. Every candidate below speaks this.
2. **Serving listeners** over HTTP with ICY metadata, behind
   [nginx/snippets/icecast.conf](../../nginx/snippets/icecast.conf) with `proxy_buffering off` and a
   deliberately small `burst-size`.
3. **Being the authoritative live listener count.** `IcecastStatsClient` polls, `IcecastEventFeed`
   follows `/admin/eventfeed`, and `AudienceWatch` turns both into the gate that decides whether the
   station airs at all in `playout.airMode: audience`.
4. **Being a container an operator can read**, configured from `deadair.settings` through
   `StreamService.materialize` and restarted by [config-watch.sh](../../stream/config-watch.sh).

**Job 3 is the whole question.** `AUDIENCE_POLL_MS` is a minute *because* the event feed carries both
edges within milliseconds. Any server without an equivalent does not merely lose a feature, it
changes how long a station takes to come on air for somebody who just tuned in. Icecast 2.5's
`source-listeners-changed` is unusually good at exactly the thing this station leans on hardest, and
that is the fact that survives every comparison below.

## The survey, so it is not repeated

| Candidate | Verdict |
| --- | --- |
| **Icecast-KH** | Same protocol, same stats endpoints, better connection handling. Effectively drop-in. Reward is small now 2.5.0 has landed and the support clock reset to 2026-12-31. Keep as a fallback if 2.5 misbehaves, not as a project |
| **Liquidsoap `output.harbor`** | Drops a container, and its `on_connect`/`on_disconnect` callbacks are a *better* audience signal than polling anything. But it makes the process doing the mixing also the listener-facing server, with no admin surface. Defensible for one operator, wrong the day there are two |
| **MediaMTX / SRS** | The only option that would move [stream-latency.md](stream-latency.md) to sub-second, via WebRTC/WHEP, and both expose live reader counts so the gate survives. Costs ICY metadata entirely (less painful here than usual, since `nowplaying` already exists out of band) and all legacy-player compatibility. Worth prototyping as an *additional* mount, never as a replacement |
| **HLS from Liquidsoap** (`output.file.hls`) | Cheap, cacheable, works everywhere, 6-30s late. Listener count degrades to counting segment requests in access logs, which is precisely the "zero and unknown are the same number" failure `AudienceWatch` exists to refuse. A second mount, not a replacement |
| **SHOUTcast DNAS** | Proprietary, legacy, worse stats. No |
| **AzuraCast / LibreTime** | Not alternatives. They are stacks *wrapping* Icecast and Liquidsoap. deadair is that layer |
| **Managed hosts** | Trades the compose file for a vendor and a bill, and loses the admin endpoints that job 3 depends on |
| **RSAS** | The only one worth a real feasibility pass. Below |

## RSAS, measured against its own docs

Read 2026-08-18 from <https://www.rocketbroadcaster.com/streaming-audio-server/docs/>. Two things
here inverted the guess that preceded them, in opposite directions.

**It reads `icecast.xml` directly.** The migration page calls it a drop-in replacement, same XML
schema, no conversion: copy the file and start. So there is no second config renderer.
[stream.config.ts](../../apps/api/src/modules/stream/stream.config.ts),
[icecast.xml.tmpl](../../stream/icecast.xml.tmpl) and
[stream.staleness.ts](../../apps/api/src/modules/stream/stream.staleness.ts) survive nearly intact,
which was the bulk of the imagined cost and is not real. Checked against the template: RSAS does not
support directory publishing, custom HTTP headers, master-slave relays or playlist files, and the
template uses none of them (`<public>0</public>`, and nginx does the headers). The one certain edit
is `<paths>`, which is pinned to the `libretime/icecast` image layout.

**HLS is Pro edition, $25/month**, it repackages rather than transcodes, and it lands at 15-30s of
latency. That is no better than `output.file.hls` out of Liquidsoap, which is free and touches no
server. The capability that looked like RSAS's real draw is paywalled and unremarkable, so the
argument for it is now essentially "lower CPU under listener load", at a scale this install does not
have.

**There is no event feed, and nothing resembling one.** No webhooks, no SSE, no listener
connect/disconnect notification anywhere in the API or statistics documentation. What exists:

- **`/health`**, JSON, native, the right target: `total_listener_count`, per-mount `listener_count`,
  plus `metadata.now_playing`, with an optional `<health-password>`.
- **`/status-json.xsl`**, an emulation, **off by default** (`<icecast-status-page>1</icecast-status-page>`
  under `<emulation>`), and the docs say some fields return default values. Do not build on it.
- **`/admin/stats`**, legacy and **XML**. `IcecastStatsClient` is JSON-only, so this is not the free
  ride the path suggests. The docs also state the Icecast admin interface is not implemented.

So on RSAS the audience gate polls and nothing more, and the poll has to drop from a minute to a few
seconds when no feed is attached, which is what the code did before the feed existed. That is the
price, and it is paid in how long an `audience` station takes to notice its first listener.

**The free edition caps at 100 concurrent listeners** and one instance per machine. The template
already sets `<clients>100</clients>`, so it costs nothing today, but it is a cap and it is on the
free tier only.

**There is no Docker image.** A Debian `.deb`, an RPM, or a static 64-bit binary needing glibc 2.27
or later. The stream image is already custom, so this is ordinary work, but it is work that has to be
maintained. The docs carry **no licence and no redistribution terms**, which is a live question the
moment a closed-source binary is baked into an image that might be published, and a larger version of
the norm `analysis/README.md` § "The rule, stated once" sets for the analysis path.

One promising detail: `GET /admin/metadata?mount=&mode=updinfo&song=` exists with the shape
Liquidsoap already uses, so the ICY path the template's long `<username>`/`<password>` comment was
written about probably works. Probably is doing real work in that sentence; see the unknowns.

## What building it would look like

Three phases, each leaving a working tree and each one commit.

1. **Add `/health` to the stats client's probe list**, with a parser branch for its shape.
   Standalone and useful alone: Icecast 404s it, so the existing probe-and-cache logic in
   `IcecastStatsClient` just moves past it, and the change is exercisable against the running
   station.
2. **Introduce `stream.serverKind`**, branch `<paths>` and the audience poll interval on it, and
   rename `stream.icecastHost` / `stream.icecastPort` to neutral keys. Still only Icecast; the seam
   is what lands. Nothing has shipped, so rename in place rather than keeping the old keys alive.
3. **Add the RSAS image and compose profile.** Dockerfile over the `.deb` or the static binary, a
   pinned version, and the settings help text that says what the operator gives up.

## The two unknowns, both for phase 3

Neither is answerable from the documentation and both should be measured rather than reasoned about.

- **Does RSAS honour `burst-on-connect` / `burst-size` at 8192 B?** That number is the station's
  latency floor and the template's comment is specific about why it is that small. A server that
  silently ignores it, or interprets it in seconds rather than bytes, changes the thing
  [stream-latency.md](stream-latency.md) measures.
- **Does the mount-scoped `<username>` / `<password>` pair authorise `/admin/metadata` the same
  way?** On Icecast 2.5 the absence of that pair produced a 401 on every metadata update, and the
  only symptom was a listener's player showing a track that was no longer playing. The same failure
  on RSAS would look identical, which is to say like nothing.

## Recommendation

**Keep Icecast 2.5.0.** It has five years of support left, the event feed is unusually well suited to
the one thing this station cannot do without, and nothing in the tree is currently limited by it.

If the seam is wanted anyway, **phases 1 and 2 are cheap and stand on their own**: they make the
stream server a choice rather than an assumption, and phase 1 costs almost nothing. **Phase 3 is the
part to hold**, because it buys CPU headroom this install will never notice, in exchange for a
degraded audience gate, a maintained image over a closed-source binary, and an unanswered
redistribution question.

If low latency is the real motivation, the answer is MediaMTX as a second mount, not a different
Icecast. If reach is, it is `output.file.hls`. Both slot into the seam
[stream-formats.md](stream-formats.md) already describes for the Opus, AAC and FLAC mounts, and
neither needs the stream server to change at all.
