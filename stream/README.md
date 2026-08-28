# Stream (Icecast + Liquidsoap)

> **Read the app-side halves as the target, not the tree.** These assets are the finished stream
> from the pre-re-scaffold repo, restored ahead of the app code that drives them. What is NOT built
> here yet, and what this file therefore describes as intent: the config materializer that writes
> `radio.env`, the playout module (`Rundown`, `PlayoutPusher`, `/playout/bridge/aired`), and the
> Spotify login route. What is genuinely gone rather than pending: the render pipeline, so nothing
> pushes DJ voice to the harbor and there is no `GET /playout/segment/:id`; and Navidrome, so
> Subsonic URLs are a shape this supports rather than a source that exists. There is no director,
> so the duck and talk-over settings below are constants rather than console knobs.

Liquidsoap mixes a **music bed** (ducked under the DJ/news/weather voice) and pushes
it to the **Icecast** mounts. Config comes from `radio.env` (materialized from the DB
by the app, falling back to `radio.default.env`) and the committed `radio.liq`.

### The mounts

MP3 is always published and has no switch. It is the compatibility **floor**, not a preference: a
Sonos takes MP3 or AAC for a manually added radio URL and nothing else, and a car head unit and a
hardware radio are narrower still. Three more are opt-in, off by default, each costing an encoder
running 24/7 in this container whether or not anybody is listening to it:

| Mount | Setting | Default rate | For |
| --- | --- | --- | --- |
| `STREAM_MOUNT` | always on | `stream.bitrate` | everything. Never switch this off |
| `STREAM_MOUNT_OPUS` | `stream.opusEnabled` | 160 kbps | best quality per bit; browsers and modern players. Costs a 48 kHz resample, which Opus mandates |
| `STREAM_MOUNT_AAC` | `stream.aacEnabled` | 192 kbps | the one that widens **hardware** reach. No resample |
| `STREAM_MOUNT_FLAC` | `stream.flacEnabled` | ~900 kbps | lossless transport, worth having only when the records are lossless too |

Their paths are **derived** from `STREAM_MOUNT` by swapping the extension (`/live.mp3` gives
`/live.opus`), by the app, in `stream.settings.ts`. An **empty path is how "off" is spelled**:
`radio.liq` builds no encoder and opens no connection for a mount it was given no name for.

Three things about them that are not obvious and each cost something to rediscover:

- **The bitrate is a branch, not an interpolation.** `%mp3(bitrate=…)` takes
  `int_of_string(...)`; `%opus` and `%fdkaac` do not, because their bitrate is read when the
  script is parsed. So each has a function covering a fixed set of rates, and that set is the
  same one `stream.settings.ts` offers the console. Change one and change the other.
- **The whole script is type-checked whether or not a branch runs**, so an encoder this build
  does not have takes the MP3 mount down with it, for an operator who never switched that format
  on. Probe it before writing one, with the loop further down rather than with `--list-plugins`.
- **FLAC is `%ogg(%flac)`, not `%flac`.** The bare encoder writes a FLAC *file*, whose header
  declares a total sample count a stream does not have.

Every mount is fed from `bus`, the brick-wall limiter, and never from `radio`. One taken off
`radio` skips the -1 dBFS ceiling and hands a listener the inter-sample peaks it exists to leave
headroom for.

**Checking a change to any of this. Do not check `/radio/radio.liq` in the container.** That path
is a SINGLE-FILE bind mount, so it is bound to an inode rather than to a name, and an editor that
writes a temporary and renames over it — which is most of them, and `perl -i`, and the tools an
agent uses — leaves the container holding the old inode or a half-written one. Measured on
2026-08-28: the host file was 1522 lines and the container's was 1512 plus a line truncated
mid-sentence, and Liquidsoap duly reported `Error 2: Parse error` pointing at a comment, at exactly
the character the truncation fell on. Two hours went into the script over a file that was already
correct.

So pipe the file IN, which is what the harnesses below already do and for the same reason:

```
docker compose exec -T liquidsoap sh -c 'cat > /tmp/c.liq; liquidsoap --check /tmp/c.liq; echo "EXIT: $?"' < stream/radio.liq
```

`EXIT: 0` and no output is the only result that means anything. Read the exit code rather than
the absence of a visible error: a `Warning` and an `Error` print the same way, and a truncated
paste of the output reads as success.

**`--check` does not start outputs, and that gap has cost this station its air twice.** It
type-checks and evaluates, so it catches a wrong argument type and a missing encoder — and an
output that type-checks perfectly and then fails when it is STARTED takes the whole script down
with it, both Icecast mounts included, with `--check` still reporting clean. `hlsout.check.liq`
exists for that: it runs one output against silence in a temporary directory, so the question
"does this output actually start" is answered without airtime. Anything that adds an output here
should get the same treatment before it goes near a container restart.

To make the RUNNING container adopt an edit, recreate it rather than restarting it — a restart
re-execs against the same stale inode:

```
docker compose up -d --force-recreate liquidsoap
docker compose exec -T liquidsoap md5sum /radio/radio.liq   # must match `md5 -q stream/radio.liq`
curl -s -o /dev/null -w '%{http_code} %{content_type}\n' --max-time 2 http://127.0.0.1:8000/live.mp3
```

`200 audio/mpeg` is a mount with a source on it; `404` is one without. Icecast answers `405` to a
HEAD, so this has to be a GET that is cut short rather than `curl -I`.

Three more things that cost the same afternoon.

**`docker compose exec` does not inherit the entrypoint's environment** — the entrypoint sources
`radio.env` into its own shell — so a check that does not source it first is checking the script
with every setting at its default. That is usually harmless, since every read has a default, but it
means the check is not exercising the operator's actual configuration.

**`Warning 4: Unused variable bus` is not cosmetic.** It means whatever is being passed to an output
is not reaching it, which is a mount fed by nothing, which is silence. The way to earn it is to give
a function a parameter named `source`, shadowing Liquidsoap's own namespace, so the body reads the
namespace instead of the argument. That is not a type error, so it does not fail the check.
`Warning 6: Top-level variable X is overridden!` is the same problem announced honestly; `icy`,
`encoder` and `source` are all names Liquidsoap already has.

**An optional setting arrives here as the EMPTY STRING, not as an absent one.**
`environment.get(key, default=…)` answers its default only when the variable is UNSET, and the app
writes every optional key unconditionally — a switched-off format gets `STREAM_AAC_BITRATE=''`
rather than no key at all. So the default never applies, and `int_of_string("")` RAISES: `Error 14:
Uncaught runtime error` during startup, which takes down every output in the file including the
mounts that had nothing to do with the empty setting. Measured: switching HLS on with AAC off
silenced both Icecast mounts, because the HLS block read the AAC bitrate whether or not AAC was on.
Use `env_float` (defined at the top of `radio.liq`, on `string.to_float`, which returns its default
instead of raising) and `int_of_float(env_float(...))` for an int. That helper already existed, and
already carried a comment about `float_of_string` raising on the empty string the last time this
took the station off air.

**`icy_metadata` and `send_icy_metadata` are both parameters of `output.icecast` and are not
variants of one another.** `icy_metadata : [string]` is the list of metadata FIELDS an update
carries (`["song", "title", "artist", …]`); `send_icy_metadata : bool?` is whether to send one at
all, guessed from the container when null. Passing the switch to the field list is a type error
rather than a wrong setting, so it costs a crash loop rather than a mislabelled mount — the better
failure, but only once you know which of the two you are holding.

To test whether an encoder exists in the pinned image at all, which decides whether a mount can be
offered: write it to a file rather than passing an expression, and keep `%mp3` in the list as a
control, since a broken harness reports every encoder missing in exactly the same way as a missing
one.

```
for e in '%opus(bitrate=160)' '%fdkaac(bitrate=192)' '%ogg(%flac)' '%mp3(bitrate=128)'; do
  printf '%-28s ' "$e"
  docker compose exec -T liquidsoap sh -lc "echo 'ignore($e)' > /tmp/p.liq; liquidsoap --check /tmp/p.liq" >/dev/null 2>&1 && echo OK || echo MISSING
done
```

Measured on `savonet/liquidsoap:v2.4.5`, 2026-08-28: all four are present. `--list-plugins` is not a
substitute — it lists no `opus` line at all on this image, encoder or decoder, and the encoder is
there regardless.

The voice is a **live harbor input**, not files: the app streams each rendered segment — talk
breaks, station sign-ons, podcast episodes — to Liquidsoap's `input.harbor` mount (`HARBOR_PORT`,
default 8005, published on localhost) over the Icecast source protocol, and the bed ducks under it
while a push is connected. This replaced an earlier file-drop playlist that relied on inotify,
which doesn't fire across Docker Desktop for Mac's bind mount, so no segment ever aired.
`HARBOR_PASSWORD` is a DB-seeded secret shared between the app (push) and Liquidsoap
(auth); like the Icecast passwords, a container that first started on the committed
`radio.default.env` dev default adopts it on the restart `config-watch.sh` triggers when the
app renders one (see below).

Each record is **trimmed** before it is levelled, on the `liq_cue_in` / `liq_cue_out` the app stamps
on the `annotate:` uri from `deadair.track_analysis`. There is no operator for it: 2.4.5 removed
`cue_cut` and does the trim during request resolution, so the keys apply wherever the request is
resolved and the old silent failure — annotations accepted and ignored because nothing sat in the
graph — cannot happen any more. A track the station has not measured yet passes through untouched,
which is the ordinary case. The level follower therefore never sees the leading silence, and the
blend is sized against the trimmed record; note that `cross` presents its output as one never-ending
track, so nothing `track_sensitive` above it sees a boundary.

Then it is **set to the station's level**, from the same measurement: `amplify(override="liq_amplify")`
sits between the trim and `normalize`, acting on a gain the app resolved before the record was handed
over (`apps/api/src/modules/playout/gain.ts`, stamped by `annotate.ts`). Same silent failure as the
cue keys — the annotation is accepted and ignored without the operator — plus one of its own: the
value carries a `dB` suffix, and without it Liquidsoap reads the number as a linear factor, so `-3 dB`
and `-3` differ by the audio being inverted and amplified tenfold.

`normalize` stays, demoted, and **it can only pull down**. It is now what catches records the station
has not measured, and its arguments are set against the one thing a follower reliably gets wrong: a
fade is a level falling for tens of seconds, which reads as a record that needs lifting, so the
default follower rides the gain up as the music leaves and makes an ending get louder. `threshold=-25.`
holds the gain through anything that quiet and `up=30.` puts its reaction time outside the length of a
passage, but neither closes it, because the lift is only half the fault. `gain_max=0.` closes that
half, since an elevation that is never built cannot carry across, and it costs nothing here: every
record this station has measured falls between -18.5 and -4.9 LUFS and nothing in the library wants
lifting towards -16.

**The other half was a claim about this operator that was written down and never true.** It said the
gain state is continuous across a track boundary, because there is one operator over the whole queue.
Read against 2.4.5's `normalize` in `src/libs/audio.liq`, `track_sensitive` defaults to true and
installs `on_track(fun (_) -> v := 1.)`: the gain snaps to unity at every boundary. Once `gain_max` is
0, unity is the loudest this operator can be, so that snap is always UPWARD — each record opens at the
top of the follower's range and is pulled back down over `down`, a tenth of a second, while the RMS
smoother behind it is still reading the tail of the record that just ended and so holds it there
longer. A record following a fade opens at full level, and under a crossfade the swell is the whole
transition: the outgoing tail rides whatever cut it had earned while the incoming record is mixed in
with none. `track_sensitive=false` is what makes the sentence true rather than merely written, and the
reset it removes is not the safety it looks like, because the only state left to carry is a cut,
released by `up` over thirty seconds and never inside a fade. When coverage is complete the operator
comes out entirely and `gain.ts` is the whole level policy.

`radio.liq` is read once at process start, so a change here needs `docker compose restart liquidsoap`;
`config-watch.sh` watches `radio.env` and nothing else.

Then one record is **blended into the next**, from the same measurement again: `cross` sits above
`normalize`, so the two records overlapping are each already at the station's level and the follower
is never chasing a mixture. The length is `min(outgoing.outro, incoming.intro)`, decided by the app
per boundary (`apps/api/src/modules/playout/crossfade.ts`) and stamped as `liq_cross_duration`. So a
record that ends cold is barely ridden and one that fades is ridden only as far as the next record's
intro can absorb it, and a blend can never eat a cold opening. Same silent failure as the keys above
without the operator, plus three of its own, all measured against 2.4.5:

- **A duration of zero does not mean no blend, it means no output.** `cross` never appends a frame,
  so it never sees the end of the track, never advances past buffering, and the source it hands out
  is never ready. A boundary the station does not blend is stamped a tenth of a second instead, and
  the transition plays a plain `sequence` at or below that.
- **`persist_override=true` is required**, or the override is reset before it sizes the stamped
  track's own buffer. The flip side is that a stamp lingers over later unstamped tracks, which is why
  the app stamps every item including the ones it does not blend.
- **The fade must span the whole buffer.** A shorter fade leaves the outgoing record at full level
  while the incoming ramps in, which sums to about +6 dB. To vary a blend, vary the buffer.

Whether a broadcast blends at all is the running order's, not the station's: a rotation does, an
album played in full does not, because its segues are the point. See `resolveRules`.

**Two things about it are counter-intuitive and were both found by measuring a render, not by
reading.** Neither failed loudly; the station simply cut between records as though nothing had been
built.

- **A boundary is stamped on BOTH records that form it**, as the outgoing one's `liq_cross_end_duration`
  and the incoming one's `liq_cross_start_duration`. The combined `liq_cross_duration` key looks like
  the obvious choice and is a trap: it sets both ends of ONE record, so two adjacent items hand the
  operator two different numbers for the same boundary and the shorter wins. Since a hard join is
  stamped on everything that does not blend, and something that does not blend follows most things
  that do, that collapsed every blend on the station.
- **`type="sin"` is not equal-power.** Liquidsoap's `sin` shape is `(1 + sin((x - 0.5) * pi)) / 2`, a
  raised cosine passing through 0.5 amplitude at the midpoint. Like `lin` it is complementary — the
  fade out is one minus the fade in — and any complementary pair sums to half power in the middle,
  measured as a 3.08 dB hole in the centre of every blend. `log` and `exp` are not complementary;
  sweeping the curve puts `log` at 6.4 with a worst deviation of 0.12 dB.

### Checking it

`crossfade.check.liq` renders the transition over synthetic tracks whose frequencies are not
harmonics of one another, so each record's amplitude envelope can be recovered independently and the
overlap length, the combined power and the hard join become numbers. `crossfade.check.py` reads the
result and says which checks passed.

```
docker compose exec -T liquidsoap sh -c 'cat > /tmp/x.liq; timeout 90 liquidsoap /tmp/x.liq >/dev/null 2>&1; cat /tmp/crossfade.check.wav' < stream/crossfade.check.liq > stream/crossfade.check.wav
python3 stream/crossfade.check.py
```

`voicecue.check.liq` answers the other half: where a DJ break lands once a crossfade is in the graph.
It arms a cue six seconds into a record with a four second blend in and an eight second blend out, so
a timing correction reading either blend is distinguishable from no correction at all, and reports
where the break actually landed.

```
docker compose exec -T liquidsoap sh -c 'cat > /tmp/v.liq; timeout 120 liquidsoap /tmp/v.liq >/dev/null 2>&1; cat /tmp/voicecue.check.wav' < stream/voicecue.check.liq > stream/voicecue.check.wav
python3 stream/voicecue.check.py
```

**A cross needs no correction there, which is the opposite of what it looks like.** `on_air_elapsed`
is a wall clock zeroed by an `on_track` below the cross, so it looks like it must run ahead of the
audience by the buffer. It does not: with a buffer of L the operator pulls its source L ahead, so the
source crosses into the next track at output time `(its start - L)`, and the overlap is L long, so it
begins at that same instant. The counter starts exactly as the record becomes audible. A version that
added the blend to the due time put a six second talk-up at 14.5 seconds.

`liveboundary.check.py` is the third, and it measures the real mount rather than a render: capture
the stream with a listener connected (the connection is what holds the audience gate open), log
`GET /nowplaying` alongside it, and it reports the level across each join and how abruptly the
spectrum changed there. Its own docstring carries the capture commands.

It answers less than the synthetic checks and answers it about real records, so the two are
complements rather than alternatives. What it can settle: whether a join has dead air in it, and
whether the change from one record to the next happened in a single instant. What it cannot: how long
a blend was. **Two records do not separate the way two tones do** — an earlier version tried to unmix
each frame against spectral templates from either side, and reported a 23 second "transition" between
two records that had cut straight from one to the other, because two broadband rock records resemble
each other's templates about as much as their own.

**A hard cut with a quiet tail before it is the signature of an unmeasured track**, not of a broken
crossfade. No analysis row means no `liq_cue_out` to trim the fade-out and no blend to ride over it,
which is correct on both counts. Check that before suspecting the code:

```
docker compose exec -T db psql -U postgres -d deadair -c "select count(*) filter (where complete and schema_version >= 1) trusted, count(*) total from deadair.track_analysis"
```

**The transition in both liq harnesses is COPIED from `radio.liq` between two marker comments, and
nothing enforces that.** Re-copy it when the real one changes, or the checks quietly stop testing the
station.

One thing it costs: `playout_queue.remaining()` is read below the `cross`, so the `remainingMs` in a
reading runs ahead of the listener by whatever is buffered. It is display-only and nothing schedules
against it, so it is left alone rather than corrected into a second number that could disagree.

The target is in THREE places and they have to agree: `playout.targetLufs` in `deadair.settings`,
which is what the app gains each record to, and the two `normalize(target=…)` calls here — the
playout follower and the local music bed — which are what everything unmeasured is pulled toward.
Change one and change the others, or the follower spends every record undoing the static gain and
the fallback bed sits at a different level from the programme.

**The stamp is stripped the moment it has been applied, and that is not tidiness.** Liquidsoap's
`amplify` takes an `override` parameter that DEFAULTS to `liq_amplify`, and a set override REPLACES
the factor you passed rather than multiplying with it (`k = match override with Some o -> o | None ->
coeff ()`). So any `amplify` that does not say `override=null` and sees a record still carrying the
key is two bugs at once: the correction lands twice, and whatever that operator was actually asked to
do is silently discarded.

The offender was **inside the standard library**, which is why `metadata.map` removing the key beats
auditing call sites: `normalize` ends in `amplify(id=id, {v()}, …)` with no `override`
(`src/libs/audio.liq`), so the follower in the playout chain re-applied every measured record's stamp
and threw its own computed gain away. Records aired at `target + stamp` instead of `target` —
measured off the mount at -26.3 LUFS against a -7.9 LUFS break, an 18 dB gap where the design puts
the voice 2 dB UNDER the music — and `normalize` was not normalizing anything except the records
nobody had measured. It read as "the music is quiet", and nothing in any log named it, because every
stage was doing exactly what it was told.

Two call sites in `radio.liq` had the same latent fault and now pass `override=null` explicitly: the
duck (where the discarded factor was the duck RAMP, so no stamped record ever ducked under the voice)
and the `VOICE_GAIN_DB` trim in the mic chain (where it was the operator's own knob). The voice queue
never meets the strip above, so that one is load-bearing rather than belt-and-braces.

The **duck** is ours, not `smooth_add`'s: `radio.liq` ramps a gain ref on the bed while the
harbor source is ready, and `add`s the voice on top. `smooth_add` fades the bed down but never
back up ([#3714](https://github.com/savonet/liquidsoap/issues/3714)). Depth and ramp are
`DUCK_GAIN_DB` / `DUCK_FADE_MS` in `radio.env`, read at startup, so tuning them by ear needs a
Liquidsoap restart.

The **voice has a mic chain** of its own, between the voice queue and both mixes: a 40 ms `fade.in`,
a compressor, then a `VOICE_GAIN_DB` trim. It exists because the duck is a fixed number of dB, so it
only lands the voice where it belongs if the voice arrives somewhere predictable — and without this
the level of a segment is entirely whatever the speech plugin produced. The fade has no matching
`fade.out` and cannot have one: on a `request.queue` source Liquidsoap does not know the remaining
time, so `fade.out` treats the whole clip as inside the fade zone and multiplies it to silence. Fade
a tail at render time instead.

**The level itself is decided by the app, per segment, and stamped.** The compressor runs with no
makeup gain, so the chain can only ever make a segment quieter, and a speech engine aims at nothing:
four voices of the bundled one measure between -25.5 and -28.3 LUFS (BS.1770) against records the
station airs at -16. So the app stamps `liq_amplify` on the `annotate:` uri it arms the cue with,
exactly as it does on every record it pushes, and the `amplify(1., override="liq_amplify", …)` at the
head of the chain applies it. `VOICE_GAIN_DB` is the operator's trim on top of that and is 0 because
it has nothing to correct, not because nobody tuned it.

The target it aims at is the station's less `playout.speechTrimDb` (a setting, 2 dB by default), not the
station's own. BS.1770 is a gated average and speech is the denser, more continuous signal, so a
break levelled to exactly what the records measure arrives on top of them. The voice sits a little
under the bed, which is where every desk puts it.

**It is stamped on both routes, and that is the point.** A break aired between two records is an
ordinary running-order item: it goes down the playout queue and never touches this chain at all. A
per-engine number in `radio.env` reaches the talk-over half and misses that one entirely, which is
how a station can have a DJ who sits right over a record and ten decibels under the gap between two.
One decision, in `playout/annotate.ts`, is what keeps the two halves at the same level.

**The compressor is now on both routes too, and the level alone was not enough.** Measured off the
station's own files, a rendered break lands near -26 LUFS with true peaks around -3 to -7 dBFS — a
crest factor no record has. Levelling that by loudness puts the body of the voice under the records
and its plosives six decibels into the bus limiter, which the records (cut to -16, peaking around
-6) never reach. A voice being brickwalled reads far louder than its loudness figure says, and
trimming the gain barely moves it because the limiter just works less. So the playout chain carries
the mic chain's compressor at the same settings, switched per item: the app stamps `deadair_speech`
on a break it pushes (`SPEECH_KEY` in `annotate.ts`), `playout_note_on_air` reads it into
`on_air_speech`, and the `ratio` getter is 4:1 while a break plays and 1:1 — genuinely off —
otherwise. A compressor left across the whole queue would pump every record: at -18 and 4:1 a track
at the station's level is over the threshold from its first bar.

The **broadcast bus** is one operator: a brick-wall limiter at -1 dBFS, between the programme and
the encoder. MP3 encoding generates inter-sample peaks around 0.5-1 dB over the source, so a modern
master clips in the listener's decoder without it; in ordinary programme it does nothing at all.
Nothing else belongs there — a loudness normaliser, a widener or a bus compressor would reshape
masters the station has no editorial claim on, and per-track levelling already happens on the leaf
sources. New outputs are fed from `bus`, never from `radio`, which is the handle the metadata
inserts are attached to.

## Playout: the app pushes, Liquidsoap plays

The station owns the running order whichever source the tracks came from, and the app hands it
over one item at a time. `radio.liq` registers four endpoints **on the harbor port** (8005 — harbor
dispatches by path, so they sit beside the `dj` mount), all gated on `PLAYOUT_BRIDGE_SECRET` in
an `X-Playout-Secret` header:

| Endpoint                 | What it does                                                                     |
| ------------------------ | -------------------------------------------------------------------------------- |
| `GET /control/status`    | the reading (below) — also the app's reachability probe                          |
| `POST /control/push`     | body is an `annotate:` uri; queues it, returns `{"rid": n, …reading}`            |
| `POST /control/flush`    | drops everything queued; what is on air finishes                                 |
| `POST /control/skip`     | ends what is on air; the queue advances to the next item at once                 |
| `POST /control/onair`    | renews deadair's lease on the mount for `CONTROL_TTL_S`                          |
| `POST /control/offair`   | hands the lease back now: off air at once, queue dropped                         |
| `POST /control/metadata` | body is one finished label line; puts it into the stream at the current position |

Every one of them answers with the same **reading** of the queue, so a mutation's own response is
already the state it produced:

```json
{ "queued": 1, "ready": true, "onAir": "b3f1…", "remainingMs": 92500, "driving": true }
```

| Field         | Meaning                                                                                                                                                                                                                                                          |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `queued`      | requests waiting, excluding the one on air (pending **and** prefetch-resolved). Note it also excludes the one currently being _resolved_, so it dips for the length of a download — the app counts its own hand-overs alongside it rather than trusting it alone |
| `ready`       | whether the queue can produce audio at all; `false` means the mount has fallen through to another bed                                                                                                                                                            |
| `onAir`       | rundown item id of the request playing, `""` when not producing                                                                                                                                                                                                  |
| `driving`     | whether deadair's lease is unexpired, i.e. whether any of this is reaching the mount. Every other field describes the **queue**; this one describes the **station**                                                                                              |
| `remainingMs` | how much of it is left; `-1` when nothing is on air or the decoder can't say (never `0` — `remaining()` uses `0` for "no item", which the app would otherwise read as a real measurement)                                                                        |

Only `queued` used to be reported, and the app paid for that: it had to deduce whether an item had
started from the depth dropping, guess when one ended (nothing announces that), and extrapolate the
playhead from when an HTTP notify happened to arrive. `ready`/`onAir`/`remainingMs` turn all three
back into measurements — see `Rundown.reconcile` (apps/api, modules/playout). The app treats a
missing `ready` as "this container is on an older script" and falls back to the old inference, so
the two halves can be deployed independently.

`metadata` is the one command about what the mount SAYS rather than what it plays, and it exists
because propagation cannot be relied on. Metadata only reaches a listener by riding a track
boundary the output can see, and this graph has two switches that move mid-track on purpose (the
bed fallback, and the lease gate above it). `track_sensitive=false` is what makes them cut
immediately, and it is equally why they carry no boundary: a packet emitted while another branch
is selected is dropped, and the mount keeps whatever it was last told. Measured on a live mount,
the title lagged the running order by two items and then stopped moving, while the audio stayed
correct throughout. So the app announces what started, on the same `on_track` it already learns
about air from, and `insert_metadata` puts that into the stream at the current position rather
than at a boundary that may never come.

`flush` and `offair` drop the queue **one request at a time** (`drop_queued` in `radio.liq`), not
with `set_queue([])`. The obvious call is a trap: `request.queue` wraps a `request.dynamic`, and a
request the prefetch has already popped and is currently downloading is in neither the pending list
nor the resolved one while its fetch runs — so replacing the queue wholesale does not remove it, it
orphans it, leaving a request nothing will play and a temp file nothing will clean up. With
`PLAYOUT_PREFETCH` at 3 there are up to three requests in that window at any moment. Removing per
request avoids it entirely, and `request.destroy` releases the download rather than waiting for
Liquidsoap to flag it as leaked. What the app sees is unchanged.

`skip` is the one command about the item already playing: the decoder lives here, so an operator
skip in the console has to come through as a request to Liquidsoap. The app pushes the lead item
first, so the skip lands on something already resolved rather than on an empty queue.

`PlayoutPusher` (apps/api, modules/playout) keeps the queue **one item deep beyond the one on
air**, reconciling against what `status` reports rather than trusting what it pushed — so a
Liquidsoap restart recovers on its own within a couple of seconds, with no app restart. It finds
the container by probing `liquidsoap:8005`, then `127.0.0.1:8005`, keeping whichever answers
(`LIQUIDSOAP_CONTROL_URL` pins one).

### The other direction: the bridge

Everything Liquidsoap and Icecast call **on the app** lives under `/playout/bridge/`, and that
prefix is the gate: `bridgeSecretMiddleware` checks `PLAYOUT_BRIDGE_SECRET` on any path beginning
with it, answering 404 while the secret is unseeded and 401 when it does not match. So a route added
there is protected by living there, rather than by whoever remembers to call a check inside the
handler — which is what it used to be, and what made a forgotten call a silently open route that
still compiled. None of these can be gated by a policy instead: ContractKit's policies evaluate
against an actor resolved from a session, and a container has neither.

| Endpoint                        | Called by  | What it says                                                                   |
| ------------------------------- | ---------- | ------------------------------------------------------------------------------ |
| `POST /playout/bridge/aired`    | Liquidsoap | which rundown item actually started                                            |
| `POST /playout/bridge/starve`   | Liquidsoap | the running order stopped producing while the lease was held, or started again |

`starve` is pushed rather than polled because the app's reconcile runs every two seconds, so a gap
shorter than that never appears in any reading it takes, and one starting just after a tick is seen
two seconds late — and a gap is the only symptom of a running order the station cannot actually
play. It is conditioned on `driving()`, so an operator's Stop is a non-event rather than a reported
starve, and a `starved` brings the app's reconcile forward instead of waiting out the tick. An empty
`PLAYOUT_STARVE_URL` means do not report, so a stream pointed at an app without the route falls back
to that app's own polling.

`POST /playout/bridge/aired` is Liquidsoap's `on_track` notify: an item is pushed
(and downloaded) an item before it airs, so that notify is the only thing that knows what the
listener is actually hearing _the moment it changes_. It is still worth having alongside the
reading — a push beats a two-second poll to the boundary — but it is no longer the only thing
that knows, which is what makes a dropped one recoverable. (In the previous incarnation, rendered
break audio was fetched from `GET /playout/segment/:id` with a one-time token, because Liquidsoap
sends no headers on a request it resolves. There is no render pipeline here, so nothing serves
that route: every item in the running order is a track.)

Probe it from the host with the secret out of `.docvol/streamconfig/radio.env`:

```bash
curl -s -H "X-Playout-Secret: $SECRET" http://127.0.0.1:8005/control/status
```

This replaced a pull (`GET /playout/next`, driven by `request.dynamic`), which asked an item
ahead of air and could not be taken back once it had resolved.

By default the music bed is the local, rights-cleared `stream/music/` library
(`MUSIC_DIR=/music`). A configured source plays through the running order above; the local library
is what the mount falls through to when the queue is empty **and deadair is still driving**.

The bed is scanned every 15s, and only files with a known audio extension and no leading dot are
offered to it (`music_extensions` in `radio.liq`). That is why `.gitkeep`, which is what keeps
`stream/music/` in a fresh checkout, does not produce a decoder error on every scan. It is a filter
on intent, not a muted log: a real track the decoder cannot read still says so. An empty bed is an
ordinary state, and the mount falls through to the bundled `station-id.mp3`.

## The dead-man switch: deadair drives, or nothing airs

deadair is the station, so nothing else is allowed to be. The local library and the bundled ident
would otherwise keep a mount playing long after the app that was supposed to be programming it
crashed, was redeployed, or restarted and lost its running order — sound nobody chose, from a
station whose whole premise is that the app chooses.

So control is a **lease**, not a state. `radio.liq` airs the programme only while an unexpired
assertion exists; the app renews it with `POST /control/onair` on the same two-second reconcile
that was already polling `/control/status` (the endpoint answers with the reading, so the lease
costs no extra request). The app asserts only while it actually **has** a programme — something on
air, handed over, or queued — so an app that is merely _running_ does not hold a mount it has
nothing to put on.

### The second condition: somebody has to be listening

The lease has two conditions, not one. A programme is the first. An **audience** is the second, and
it is the default: `playout.airMode` in `deadair.settings` is `audience` unless an operator sets it
to `always`. Producing audio costs a provider fetch and a download per track on a rate-limited
account, and an empty mount is the one case where nobody benefits from spending them.

The count comes from Icecast, which is the only thing that knows: Liquidsoap sees a socket it
writes to and nothing about the far end. `AudienceWatch` (apps/api, modules/playout) polls it every
five seconds, and that poll is the **truth**.

Which endpoint it polls depends on the Icecast, not on anything an operator set. `IcecastStatsClient`
asks `GET /admin/publicstats.json` first (2.5's, presented with the `stream.adminPassword` as HTTP
basic — it answers anonymously on a default 2.5 config, but access under `/admin/` is a role decision
an operator can tighten, and `/admin/eventfeed` on the same server is not anonymous), and falls back
to `GET /status-json.xsl` (2.4's, which 2.5 deprecates). The two documents carry the same facts in
**different shapes**; `listenersForMount` handles both, and `docs/todo/icecast-2.5.md` has each
payload as measured. The base and path that answered are cached together, so the endpoint an install
does not have costs one probe per re-probe rather than one per poll, and a boot log line names the
one in use. A 401 or 403 from the admin endpoint is said once and then ignored: it means a server
that has it and will not let us read it, which is a config to fix, not a reason to stop polling. See
`docs/todo/icecast-2.5.md` for what the 2.5.0 upgrade did and did not settle.

On a 2.5 there is a second push half: `IcecastEventFeed` holds `GET /admin/eventfeed` open (SSE) and
hands each `source-listener-count` for the mount straight to `AudienceWatch.report()`, so a change
lands in milliseconds. It attaches **only** when the poll resolved the admin endpoint, so against a
2.4 server it never opens a socket, and it reconnects with backoff because a dropped feed is an
ordinary state. Whole counts, never deltas, which is what makes a lost message cost the edge rather
than the number. Same division as `/playout/bridge/aired` and `/control/status`: the push beats the
poll to the edge, and the poll is what makes a dropped push harmless.

Icecast used to push a second way, and it is worth knowing why it does not any more. Through
`<authentication type="url">` on the mount, `listener_add` and `listener_remove` called
`POST /playout/bridge/listener`, gated on the same bridge secret, which beat a five-second poll to an
arrival. That path is **gone** — with it went `listener.credential.middleware`, which existed only to
move the HTTP basic password Icecast sends onto the `x-playout-secret` header the rest of the bridge
uses, and the `stream.listenerHooks` setting that switched the whole thing off. The event feed reaches
both edges in milliseconds without any of it. Two things it cost, which are the reason it is not
missed: `listener_add` was a **blocking authentication call**, so Icecast held each arriving listener's
connection open until this app answered and an API that was down **refused** new listeners outright;
and URL authentication needs an Icecast built with libcurl, which one built without refuses to start
without.

Once the last listener goes, the audience **lingers for a minute** before the gate closes: a player
reconnecting drops to zero for a second or two and comes straight back, and rebuilding a mount for
that is audible where the gap is not. The app then calls `POST /control/offair` immediately rather
than letting the lease lapse, and **the queue stays empty while the gate is shut**.

Both of those are for the same measured reason, which is worth stating because the opposite is the
intuitive guess: **Liquidsoap keeps consuming the playout queue whether or not `driving()` selects
it.** With the gate shut and an item queued, the reading's `remainingMs` still falls in lockstep
with the wall clock. A source inside the streaming graph is ticked by its clock; the gate above it
only decides whether anyone hears the result. So an item left in the queue plays out to an empty
mount, and a station left to "warm up" works through its whole lineup at one provider fetch and one
download per track, which is precisely the cost this gate exists to avoid.

The first listener therefore waits a second or two while the head of the running order is resolved
and fetched. Buying that back means freezing the source in `radio.liq` (a separate clock, or
`source.dynamic`), not queueing ahead from the app.

What the player gives up on the way down is not lost: `Rundown.reconcile` takes back every item the
player turns out not to be holding, so the station **resumes where it stopped** rather than skipping
whatever was in flight. Only the track that was part-played is dropped.

When the lease lapses, the source stays connected to Icecast and airs **digital silence**: a
listener keeps their connection and hears the station come back rather than having to reconnect to
a mount that 404'd. The cut is immediate (`track_sensitive=false`), not at the next boundary — a
boundary may be minutes away, or never.

Silence is **labelled**, and has to be asked for explicitly. A mount's title only changes when a
source emits metadata, and silence has no track boundaries to emit one at — so without a nudge the
last track's label stays up indefinitely, and a listener still connected watches a track that
ended minutes ago. `radio.liq` therefore announces the station's own name into the stream on the
tick the lease lapses. Bed tracks get the same treatment where their files carry no tags of their
own; a bed track that knows its title keeps it.

`CONTROL_TTL_S` (default 6s, three reconciles) is the window. Both ends come from one constant:
the app materializes it into `radio.env` from `CONTROL_TTL_S` in
`apps/api/src/modules/playout/liquidsoap.control.ts`. Too short and a slow tick drops the mount;
too long and a dead app keeps broadcasting for that many seconds.

Consequences worth knowing before they surprise you:

- **Stop means out of service.** `POST /playout/stop` stands the station down: the running order is
  dropped, what is on air stops, and the mount goes quiet. It no longer falls back to the bed, and
  it is the one thing that silences a station people are listening to.
- **A silent mount is usually not a fault.** In `audience` mode a station with a full running order
  and nobody connected is silent on purpose. The console says `ready` rather than `off air` for
  exactly that state.
- **The console's own monitor is a listener.** It plays the mount, which is the point of it, so an
  operator listening in the browser holds the station on air like anyone else.
- **An API restart takes the station off air** within the TTL, because the rundown is in memory
  and the restarted process has no programme to assert for. Press play again. The rundown is
  deliberately not persisted; see `apps/api/src/modules/playout/rundown.ts`.
- **Replacing the running order does not cut the listener off.** `load()` flushes what has not
  aired and keeps the lease; only a stand-down releases it.

## Spotify playout (the track shim)

Real Spotify audio on the stream, personal/local use only — this is against Spotify's ToS for
public broadcast.

`stream/spotify-shim` is a small Go service built into the Liquidsoap image. It serves **one track
per HTTP request**: `GET /track/{id}?t=<signed>` fetches and decrypts the track from Spotify and
returns it as plain Ogg Vorbis. The app resolves each rundown item to a signed URL on it, pushes
that into the queue, and Liquidsoap downloads it ahead of air — exactly what it does with any other
pre-signed stream URL.

That is the whole point: the station **owns each track before it airs**. A skip is
`POST /control/skip` and lands at once, the playhead is the decoder's own reading rather than
wall-clock arithmetic, and a DJ break is an item in the running order.

"At once" depends on `PLAYOUT_PREFETCH`, and this is the one number to reach for if skipping feels
slow. Liquidsoap only ever **downloads** that many requests ahead of the one on air, however many
the app has pushed — so with the Liquidsoap default of 1, a skip spends the only fetched track and
a second skip during the replacement's download has nothing resolved to cut to. Measured on a real
station: **~200ms** for a skip onto a resolved item, **>1.2s and no boundary at all** for one onto
an unresolved queue. It defaults to 3 here, materialized by the app from the same constant it uses
for its own push lead (`PLAYOUT_LEAD` in `apps/api/src/modules/playout/liquidsoap.control.ts`) —
the two are useless apart, since pushing more than gets resolved buys nothing. The station used to run
go-librespot as a Connect device and read its raw PCM through `input.external`, which meant it
could only steer playback from the outside: seconds of audio were already committed to that pipe
at any moment, so a skip had to wait them out.

**Requirements:** a Spotify **Premium** account, and the Spotify plugin connected in the console
(Plugins → Spotify → Connect).

### 1. Build the image

```
docker compose build liquidsoap
```

The first build clones go-librespot at a pinned tag and compiles the shim against its packages (a
few minutes); it's cached after. Bump `GO_LIBRESPOT_VERSION` in `stream/Dockerfile` deliberately —
the shim is built against that tag's internals, so a bump is a real compatibility event.

### 2. Log in via the console (no separate Spotify login)

The shim gets its login from the account you already linked in the console. Every time the app
resolves a Spotify item it **pushes** a username + access token to the shim's secret-gated
`POST /session`, so the shim always holds a token no older than the track it is about to fetch. The
token flows machine-to-machine and is never shown in the browser. No Connect device is registered.

That secret needs **no manual setup**: on first boot the app seeds a strong random
`stream.spotifyShimSecret` in the DB (alongside the Icecast/harbor secrets, see
`ensureStreamSecrets`), presents it as `X-Spotify-Login-Secret` on every push, and materializes the
same value into `radio.env` as `SPOTIFY_SHIM_SECRET` for the shim to check it against.

The session is built **lazily** — warmed in the background when a push lands, opened on the first
fetch otherwise — and rebuilt after a failure. The container comes up before the app that mints
credentials, a station playing another source never needs a Spotify login at all, and the only
reliable signal that a session has gone is a fetch failing on it.

### 3. Play something

In the console: **Playlists**, then play one of the Spotify plugin's playlists. That fills the
running order and the pusher hands it to Liquidsoap an item ahead of air.

The first time you do this after building the image, Liquidsoap has to adopt the app-rendered
`radio.env` (which holds the bridge secret) rather than the committed default it booted on.
`config-watch.sh` does that within seconds of the app's first render, so wait rather than acting;
if the console still shows `config not adopted` after a minute, the watch is not running and this
is the fallback:

```
docker compose up -d --build liquidsoap
```

### 4. Check on it

The shim publishes a health endpoint and logs every track it serves:

```bash
curl -s http://127.0.0.1:3679/health
tail -f .docvol/streamlogs/spotify-shim.log
```

`{"ok":true,"session":false}` before the first fetch is correct — that is the lazy login. To pull a
track by hand, sign a URL inside the container (the exec does **not** inherit the entrypoint's
sourced `radio.env`, so source it):

```bash
docker compose exec -T liquidsoap sh -c 'set -a; . /streamconfig/radio.env; deadair-shim -sign <track-id>'
```

## Verify Icecast

The Icecast image ships no HTTP client, so probe from the host. On the 2.5.0 the compose file runs,
the stats document is:

```
curl http://127.0.0.1:8000/admin/publicstats.json
```

`/status-json.xsl` still answers there and is what a 2.4 server has, but it is deprecated upstream.
The event feed needs the admin password, which is ciphertext in `deadair.settings`, so take it from
the rendered `.docvol/streamconfig/icecast.xml`:

```
curl -N -u admin:<admin-password> http://127.0.0.1:8000/admin/eventfeed
```

## Neither container re-reads its config, so each one watches its own

`icecast.xml` and `radio.env` are read ONCE, at container startup — Icecast parses its config and
the Liquidsoap entrypoint sources the env file. Nothing re-reads either. So a change to a `stream.*`
setting, and above all a schema rebuild (which reseeds all five stream secrets in one query), used
to leave two live processes holding credentials that match nothing, with symptoms that name
something else entirely:

- Icecast is still on the old `adminPassword`, so the app cannot read `/admin/publicstats.json` or
  attach `/admin/eventfeed` and never learns anybody is listening. In `audience` mode that gate never
  opens: a station with a full running order stays silent, and the only log line is a 401 said once.
- Liquidsoap presents the old `ICECAST_SOURCE_PASSWORD`, the source connection is refused, no mount
  exists, and Icecast answers 404. `/status-json.xsl` shows `source: null`.

**Each container now watches its own rendered file** (`stream/config-watch.sh`, backgrounded by both
entrypoints) and stops itself when it changes; `restart: unless-stopped` brings it back on the new
config. The restart authority is inside the container that needs it, so nothing needs a Docker
socket and nothing can restart anything but itself. Two things about it are deliberate:

- **It polls the mtime; it does not use inotify.** inotify events do not cross Docker Desktop for
  Mac's host bind mount, and `/streamconfig` is one. This repo has been bitten twice (see the
  `reload_mode` note in `radio.liq`), and an inotify watcher here would look right and do nothing.

  **A third way the same mount lies, measured 2026-08-11.** `radio.liq` is bind-mounted as a single
  FILE, and a single-file mount binds an inode rather than a path. Every editor and every `perl -i`
  writes a new file and renames it over the old one, which replaces the inode, so the container goes
  on serving whatever it was started with. It presented a 1011-line copy of a 1157-line file,
  truncated mid-line, and `liquidsoap --check /radio/radio.liq` reported that as a parse error at
  the last character it had — which reads exactly like a syntax error in the new code and is not
  one. Two rules fall out of it. **Check the script by piping it in, never through the mount:**
  `docker compose exec -T liquidsoap sh -c 'cat > /tmp/c.liq; liquidsoap --check /tmp/c.liq' < stream/radio.liq`.
  And **`docker compose restart` does not pick up an edit** — mounts are resolved when a container
  is created, so it takes `up -d --force-recreate liquidsoap`.
- **It does not coordinate with the app.** The running order lives in the app's memory, so
  `PlayoutPusher` re-pushes and re-asserts the mount lease on its next two-second reconcile. What a
  restart costs is the audio on air at that instant, and waiting for a track boundary would mean
  running replaced credentials for minutes — in the reseed case, minutes of a station already off
  the air. The one thing lost is an armed talk-over cue.

Set `CONFIG_WATCH_INTERVAL_S=0` on either service to turn the watch off and choose the moment
yourself. The app's own drift warning still stands either way.

That warning is the second line, and it now means the self-restart did not happen: the app holds it
back for 45s, comfortably past the watch's worst case, so a change that heals itself is never
reported. What survives that is a watch that is off, an image that predates it, or a container
failing to come back — and then it says so in the log and on the console's transport bar with the
command to run. See `apps/api/src/modules/stream/stream.staleness.ts` for how each half is known:
Liquidsoap reports the `CONFIG_STAMP` it booted with, Icecast's `server_start_iso8601` is compared
against the file's mtime, and a render producing identical bytes deliberately does not touch the
file at all.

```bash
docker compose restart icecast
docker compose restart liquidsoap
```

## Liquidsoap version (and what to check after a bump)

`stream/Dockerfile` pins the base image; it is currently `savonet/liquidsoap:v2.4.5`, up from
v2.2.5. 2.4 buys async source callbacks (the playout `on_track` notify runs off the streaming
loop), `normalize_track_gain`, and `request.queue`'s script-level `push`/`queue`/`remove`/`length`
methods (which the push model is built on), and it is BREAKING in FOUR places
`radio.liq` touches: callbacks moved to source methods, the `annotate` protocol now checks
nested static uris, `cue_cut` was removed, and `float_of_string(default=null, …)` raises.

The last two were found the hard way on 2026-08-12 and are worth reading before the next bump,
because one of them took the station off air for a day without anything saying so:

- **`float_of_string(default=null, s)` RAISES on anything it cannot parse**, the empty string
  included — it does not return null, so the `?? fallback` it was paired with here was unreachable.
  Fatal in `playout_cross_duration`, which `cross` calls from its transition callback on every
  boundary: the raise comes out through `Cross.cross#create_after` and `Output.output#output`, kills
  the clock thread, and takes the process and the mount with it. The station aired one item after
  each restart and died on the second, about 65 times, and the only trace was a stack trace on
  stdout. Use `string.to_float(default=x, s)`, which is 2.4.5's own wrapper for this
  (`src/libs/string.liq`: `float_of_string(default=default, s)`). Fixed at all three sites in this
  script and in both `*.check.liq` harnesses, whose copies always stamp both keys and so could never
  have reproduced it.
- **`cue_cut` was removed** and the trim moved into request resolution, so `liq_cue_in` /
  `liq_cue_out` now apply whether or not an operator sits in the graph. The call is gone from this
  script; adding it back would be the no-op, which is the exact inverse of what it used to be.

Two deprecation warnings are still outstanding, deliberately. Both still work on 2.4.5 and neither
is worth a blind edit to a script whose failure mode is no stream at all, so they are the next
bump's work rather than this one's:

| Warning on every boot | Replacement | Sites |
| --- | --- | --- |
| `"map_metadata" is deprecated` | `metadata.map` | `radio.liq` bed labels (two calls) |
| `insert_metadata operator is deprecated` | the `insert_metadata` SOURCE method | `radio = insert_metadata(radio)`; note the comment further down about rebinding moving the method onto the wrong source |

**Liquidsoap logs to stdout and only to stdout**, so every one of those findings needed
`docker compose logs`. That is a wall for anything without the Docker socket — see
`docs/todo/stream-logs.md` for what it cost and the three ways to fix it.

The base's Debian release used to matter as much as the Liquidsoap version, because the
go-librespot daemon was a CGO build whose codec sonames move between releases. The track shim that
replaced it is CGO-free, so the builder stage and the runtime no longer have to agree on anything
but the Go toolchain.

Rebuild and syntax-check before running anything:

```bash
docker compose build liquidsoap && docker compose run --rm --entrypoint liquidsoap liquidsoap --check /radio/radio.liq
```

`--check` type-checks the script without opening a mount, so it catches renamed arguments and
missing operators for free. It does not tell you whether an operator still behaves the same, so
also read the signatures off the image itself rather than the docs site:

```bash
docker compose exec liquidsoap liquidsoap -h request.queue
```

`request.queue` (the playout bed), `harbor.http.register.simple` (the control endpoints), and
`add`/`amplify` (the duck) are the ones worth reading. Two behaviours the app depends on: `q.length` counts both the pending and the resolved
queue and EXCLUDES what is on air (that is the depth the pusher tops up against), and `add` mixes
only the sources that are ready and is ready when any of them is (that is what lets a
disconnected harbor contribute nothing instead of failing the mix).

Then a live run, in this order: the ident floor with an empty queue, the push path (the console's
now-playing must match what you hear, boundary after boundary), and `docker restart
deadair-liquidsoap` to confirm the pusher refills on its own.
