# Milestone 1: continuous stream — voice ducked over a music bed.
#
# A rights-cleared music bed loops continuously; whenever a pre-rendered voice
# segment is available, the bed ducks and the voice plays over it, then the bed
# comes back up. A bundled ident means the station always has something to fall
# back on, even on a cold volume with no music and no segments yet.
#
# All of which happens ONLY while deadair holds the control lease. The mount is
# not "never silent": it is silent exactly when the app is not driving it, which
# is the point of the dead-man switch further down. Everything the fallbacks do
# is about not dropping out mid-programme, never about carrying on without one.
#
# All config comes from the process env, which the container entrypoint sources
# from the app-rendered /streamconfig/radio.env (falling back to the committed
# stream/radio.default.env). See stream/README.md and the app's stream config
# materializer (apps/api).
#
# Note: level/normalize processing happens on the leaf sources BEFORE the mix, not
# after it. The DJ voice is a LIVE harbor source (step 3): the app streams each
# rendered segment to a harbor mount, and the bed is ducked under it by an explicit
# gain ramp (step 4). That ramp replaced smooth_add, which fades the bed down but
# never back up and glitches at the end of the voice (savonet/liquidsoap#3714).

settings.log.level.set(3)

# The image runs as root so the bundled helpers can write their logs. Liquidsoap's init refuses
# root by default; allow it for this local/personal container.
settings.init.allow_root := true

music_dir   = environment.get("MUSIC_DIR", default="/music")

# Harbor voice input: the app (apps/api HarborPusher) streams pre-rendered DJ voice
# — talk breaks, station sign-ons, and podcast episodes — to this mount as a live
# Icecast source, and the bed ducks under it while a source is connected.
# This replaces the old file-drop `voice` playlist, whose reload_mode="watch" relied
# on inotify, which does not fire across Docker Desktop for Mac's host bind mount —
# so newly rendered segments were never picked up and no break ever aired.
#
# The same port also carries the playout CONTROL endpoints (step 2): harbor is one
# server per port, dispatching by path, so /control/* coexists with the "dj" mount
# and the app needs only the one already-published port to both push audio and drive
# the running order.
harbor_port     = int_of_string(environment.get("HARBOR_PORT", default="8005"))
harbor_password = environment.get("HARBOR_PASSWORD", default="")

# Talk-over mode (materialized from the director's talkOverTracks setting; default true).
#   true  → the DJ talks OVER track intros/outros: the bed is ducked under the voice.
#   false → the DJ talks BETWEEN tracks in silence: the app pauses playout at the boundary and
#           the voice PREEMPTS the bed entirely (fallback), so nothing plays under the DJ.
# NOTE: this is read at startup, so toggling it takes effect only on a Liquidsoap restart (the
# app re-materializes radio.env on the settings change). The app-side pause/resume that opens
# the gap IS live — only the duck-vs-cut mix choice needs the restart.
talk_over = environment.get("TALK_OVER_TRACKS", default="true") == "true"

# How far the bed drops under the voice, and how long the ramp takes (director settings
# duckGainDb / duckFadeMs, materialized into radio.env). Read at startup like talk_over.
#
# Tolerate an unset, empty or malformed value: the materializer writes every key whether or not
# it is set. `float_of_string`'s own `default` is NULLABLE, so passing our fallback to it would
# make this whole function return `float?` and nothing downstream would accept it — hence
# `default=null` and `??`, which also folds the empty case in.
def env_float(name, default) =
  float_of_string(default=null, string.trim(environment.get(name, default=""))) ?? default
end
duck_gain_db = env_float("DUCK_GAIN_DB", -12.)
duck_fade_ms = max(1., env_float("DUCK_FADE_MS", 300.))

# The app fills a rundown and PUSHES it here item by item, whichever source the tracks came from:
# a pre-signed Subsonic URL for Navidrome, a signed track-shim URL for Spotify. Switching source
# is therefore an app-side decision that takes effect with NO container restart.
# See stream/README.md + apps/api (stream materializer).
#
# One secret gates traffic in BOTH directions: the app's calls to /control/* here, and our air
# confirmation back to the app (aired).
playout_aired_url = environment.get("PLAYOUT_AIRED_URL", default="")
playout_secret    = environment.get("PLAYOUT_BRIDGE_SECRET", default="")

# 1) Music bed: the local, rights-cleared library. randomize so a small library
#    doesn't feel like a tape loop. Normalize here (a leaf source) so user tracks
#    sit at a consistent level under the voice. Unavailable while the dir is empty
#    (handled below).
#    NOTE: reload on a timer, NOT reload_mode="watch". Watch uses inotify, and inotify
#    events do not cross Docker Desktop for Mac's host bind mount — a watched playlist
#    only ever reflects what was in the dir at container start and never sees files the
#    host drops in later. reload_mode="seconds" re-scans on a wall-timer regardless
#    (and a scan that finds nothing keeps the previous list), so newly dropped tracks
#    are picked up within the interval.
music =
  playlist(
    id="music",
    mode="randomize",
    reload=15,
    reload_mode="seconds",
    music_dir
  )
music = normalize(target=-16., music)

# The floor UNDER the programme: a bundled station ident/bed. Always available, so a gap inside
# a programme deadair is driving never becomes dead air, and the voice always has something to
# duck. It is not a floor under the station itself — the lease gate below is above all of this.
station_id = mksafe(single("/radio/station-id.mp3"))

# 2) The music bed: a request.queue the APP pushes into (POST /control/push below), one item at a
# time. Empty queue → the source is unavailable, so the enclosing fallback drops to the local
# music bed / ident for as long as deadair still holds the lease. Each pushed uri is an `annotate:` uri carrying
# the rundown item id, with the source's own auth embedded in the URL (a pre-signed Subsonic
# stream URL, or a token-gated app URL for a rendered segment), so the fetch needs no headers.
#
# Why push and not the request.dynamic pull this replaced: a resolver call is not "the item that
# is now airing" (it runs `prefetch` items ahead), and once request.dynamic had resolved an item
# there was no way to take it back. Pushing puts the running order — and the decision of when to
# commit to the next item — where the rundown already lives, and /control/flush can retract what
# has not aired yet. The app keeps one item queued beyond the one on air; that is still one item
# of LEAD, so a rendered segment must be ready when its slot is pushed, not when it airs.
#
# request.queue wraps a request.dynamic (prefetch defaults to 1), so a pushed item is resolved —
# for an http uri, curl-downloaded — while the previous one is still playing.
#
# NOTE: written for Liquidsoap 2.4.5 (the pinned image, stream/Dockerfile). `q.length` counts
# both the pending queue and the resolved-but-not-yet-playing one, and EXCLUDES what is on air,
# which is exactly the depth the app tops up against. `q.set_queue([])` clears both.
playout_queue = request.queue(id="playout")

# What the queue is playing RIGHT NOW, by rundown item id ("" before the first track, and while
# the queue has nothing to produce). So /control/status can answer "what is airing" as an
# observation rather than leaving the app to infer it from what it last handed over.
#
# The app's served/recalled bookkeeping, its recall TTL and its wall-clock playhead all exist only
# because this reading was not available: `queued` is a scalar, so "did the item I pushed start?"
# had to be deduced from the depth dropping. Reporting the id (and, below, how much of it is left)
# turns every one of those deductions back into a measurement.
#
# `synchronous=true` (2.4 requires the choice explicitly, with no default) is the point of having
# this separate from the notify below: it runs IN the streaming loop, at the boundary itself, so
# the ref is already correct before the first frame of the new item leaves the encoder — a status
# call can never catch it a track behind. Safe to run there because it is a ref assignment, not
# the HTTP call the notify has to hand off to another thread.
#
# A named def rather than an inline `fun (m) -> ...`: a `:=` assignment is a statement, not an
# expression, so as a bare lambda body it does not parse and the parser runs on looking for one
# (the error lands far downstream, at the next thing that cannot continue an expression).
on_air_item = ref("")

def playout_note_on_air(m) =
  on_air_item := m["deadair_item"]
end
playout_queue.on_track(synchronous=true, playout_note_on_air)

# The other half: tell the app which item actually STARTED. The id rides in on the request's
# `annotate:` metadata, so a skipped or retried item can't put the app's clock out of step, and
# this stays the authority on what is airing even though the app now chose the order.
# Fire-and-forget by design — the station must never wait on the app to keep playing — and
# asynchronous (2.3+ `synchronous=false`), so this HTTP call cannot block the streaming loop.
#
# Still worth having alongside the ref: the notify is a PUSH, so the app reacts on the boundary
# instead of up to one reconcile tick later. The ref is what makes a dropped notify (or an app
# that restarted through one) recoverable rather than permanently out of step.
def playout_aired(m) =
  item = m["deadair_item"]
  if item != "" and playout_aired_url != "" then
    ignore(http.post(data="", headers=[("X-Playout-Secret", playout_secret)], "#{playout_aired_url}?item=#{item}"))
  end
end
playout_queue.on_track(synchronous=false, playout_aired)

playout_bed = normalize(target=-16., playout_queue)

# ── Playout control endpoints ────────────────────────────────────────────────────────────────
# Registered on the harbor port (path-dispatched, so they sit beside the "dj" mount) and gated on
# the shared PLAYOUT_BRIDGE_SECRET the app already holds. The parameter is `req`, NOT `request`:
# binding `request` here would shadow the `request.create` / `request.id` module functions.
#
# Every one of them answers with the same READING of the queue (see playout_reading below), so a
# mutation's own response is already the state it produced.
#
#   GET  /control/status → the reading            what the app reconciles against; also its probe
#   POST /control/push   → {"rid": n, …reading}   body is the annotate: uri
#   POST /control/flush  → the reading            drop everything queued; what is on air finishes
#   POST /control/skip   → the reading            END what is on air; the queue advances at once
#   POST /control/onair  → the reading            "deadair is driving", good for CONTROL_TTL_S
#   POST /control/offair → the reading            hand the lease back now: off air, queue dropped
def control_authorized(req) =
  playout_secret != "" and list.assoc(default="", "x-playout-secret", req.headers) == playout_secret
end

def control_json(data) =
  http.response(status_code=200, content_type="application/json", data=data)
end

def control_denied() =
  http.response(status_code=401, content_type="text/plain", data="denied")
end

# One reading of the playout queue, as JSON object FIELDS (no braces, so `push` can prepend its
# rid). Four numbers, each of which the app previously had to guess:
#
#   queued       requests waiting, EXCLUDING the one on air: both the pending queue and the one
#                already resolved by the prefetch. The depth the pusher tops up against.
#   ready        whether the queue can produce audio at all: false means it has nothing (drained,
#                or the next request is still resolving), so the mount has fallen through to
#                another bed and nothing in the running order is being heard. This is the ONLY
#                way the app can learn that an item ENDED, since a boundary otherwise only ever
#                shows up as "a different one started".
#   onAir        rundown item id of the request on air, "" when not producing.
#   remainingMs  how much of it is left; -1 when there is nothing on air, or when the decoder
#                cannot say (an endless stream). Never 0 — see below.
#
# Reported unconditionally. There is one playout path — the app pushes an item, this queue fetches
# and plays it — for every source, so this reading always describes the running order rather than
# some other bed that happens to be producing.
#
# remaining() is the DECODER's position, so it runs ahead of the listener by the encoder and
# client buffers. It is still the right number to report: the app's only alternative is wall-clock
# arithmetic from when an HTTP notify happened to arrive, which drifts, cannot survive a restart,
# and is what every break's timing is currently scheduled against.
#
# Built as a string rather than returned as a record because these responses are hand-rolled JSON;
# concatenation (not interpolation) around the call site keeps the braces out of the interpolator.
def playout_reading() =
  ready = playout_queue.is_ready()
  ready_json = if ready then "true" else "false" end
  # remaining() answers 0 — not a negative — for a queue with nothing on air, so "there is no item"
  # and "the item has no time left" arrive as the same number. Collapse both into an explicit -1
  # rather than passing a 0 the app would read as a real measurement of an item that is over.
  rem = playout_queue.remaining()
  remaining_ms = if ready and rem > 0. then int_of_float(rem * 1000.) else -1 end
  # The ref keeps the last id it saw, so suppress it when the queue is not producing: a stale id
  # reported as on air is exactly the class of bug this reading exists to remove.
  item = if ready then on_air_item() else "" end
  '"queued": #{playout_queue.length()}, "ready": #{ready_json}, "onAir": "#{item}", "remainingMs": #{remaining_ms}'
end

def control_status(req) =
  if control_authorized(req) then
    control_json('{' ^ playout_reading() ^ '}')
  else
    control_denied()
  end
end

def control_push(req) =
  if not control_authorized(req) then
    control_denied()
  else
    uri = string.trim(req.body())
    if uri == "" then
      http.response(status_code=400, content_type="text/plain", data="empty uri")
    else
      r = request.create(uri)
      playout_queue.push(r)
      control_json('{"rid": #{request.id(r)}, ' ^ playout_reading() ^ '}')
    end
  end
end

def control_flush(req) =
  if control_authorized(req) then
    playout_queue.set_queue([])
    control_json('{' ^ playout_reading() ^ '}')
  else
    control_denied()
  end
end

# Cut the item on air. The app cannot do this itself: it hands over a uri, but the DECODER lives
# here, so an operator skip has to be a command to us. The queue then starts the item it has
# already resolved, whose on_track fires playout_aired above — which is what keeps the app's clock,
# now-playing and play history in step with a skip instead of a natural boundary.
#
# Skipping with nothing queued behind it is legal and simply makes this source unavailable for a
# moment, so the mount falls through to the local bed; the app pushes the lead item first to avoid
# exactly that (see PlayoutPusher.skipCurrent).
def control_skip(req) =
  if control_authorized(req) then
    playout_queue.skip()
    control_json('{' ^ playout_reading() ^ '}')
  else
    control_denied()
  end
end

# ── The dead-man switch ──────────────────────────────────────────────────────────────────────
# deadair is the station. Nothing else here is allowed to be: this script owns a local music
# library and a bundled ident, and without a gate BOTH of them keep the mount playing after the
# app has stopped driving — a crash, a deploy, a restart that lost the running order. That is
# sound nobody chose, coming out of a station whose entire premise is that the app chooses.
#
# So control is a LEASE, not a state. The app renews it by calling /control/onair, and everything
# it does not renew expires on its own. A dead app cannot hold the station by inertia, and there
# is no failure mode where "the app stopped talking to us" is mistaken for "carry on".
#
# CONTROL_TTL_S has to comfortably exceed the app's reconcile interval (2s), or an ordinary slow
# tick would take the station off air. Six seconds is three ticks.
control_ttl = max(1., env_float("CONTROL_TTL_S", 6.))

# When the lease runs out, as a unix time. Starts expired: a Liquidsoap that comes up before the
# app is not yet being driven by anything, and should not pretend otherwise.
on_air_until = ref(-1.)

def driving() =
  time() < on_air_until()
end

# Renew, and answer with the reading like every other control call — so the app's own heartbeat
# doubles as the poll it was already making, and the lease costs no extra request.
def control_onair(req) =
  if control_authorized(req) then
    on_air_until := time() + control_ttl
    control_json('{' ^ playout_reading() ^ '}')
  else
    control_denied()
  end
end

# Hand the lease back NOW rather than letting it lapse. The station standing down is a decision
# somebody made, and it should sound like one: waiting out the TTL would put six seconds of audio
# after a stop that the operator has already given. Also flushes, because an order that has been
# abandoned must not still be sitting in the queue when the lease is next taken.
def control_offair(req) =
  if control_authorized(req) then
    on_air_until := -1.
    playout_queue.set_queue([])
    playout_queue.skip()
    control_json('{' ^ playout_reading() ^ '}')
  else
    control_denied()
  end
end

harbor.http.register.simple(port=harbor_port, method="GET", "/control/status", control_status)
harbor.http.register.simple(port=harbor_port, method="POST", "/control/push", control_push)
harbor.http.register.simple(port=harbor_port, method="POST", "/control/flush", control_flush)
harbor.http.register.simple(port=harbor_port, method="POST", "/control/skip", control_skip)
harbor.http.register.simple(port=harbor_port, method="POST", "/control/onair", control_onair)
harbor.http.register.simple(port=harbor_port, method="POST", "/control/offair", control_offair)

# The live bed: the app's own running order, then the local rights-cleared library, then the
# ident. Every source the station plays now arrives the same way — the app pushes an item and the
# queue fetches it — so there is no second external bed to arbitrate against. What used to sit
# here was go-librespot streaming raw PCM through input.external, which is why the mount could be
# seconds behind the daemon and a skip had to wait out audio already committed to the pipe.
#
# track_sensitive=false so a drained queue drops through mid-item rather than at a boundary that
# may never come. This whole chain plays only under the lease (step 5).
bed = fallback(track_sensitive=false, [playout_bed, music, station_id])

# 3) Voice: the station's on-air DJ, pushed live to this harbor mount by the app
#    (apps/api HarborPusher streams each rendered MP3 in over the Icecast source
#    protocol). input.harbor is FAILABLE: it is "available" only while the app is
#    actively pushing a segment — which is what both mixes below key off, so the bed
#    ducks only during a segment and lifts the instant the push ends.
#    "dj" is the mount; user/password authenticate the push. Localhost-published.
#    buffer/max (seconds) set the harbor's startup latency vs. underrun tolerance:
#    the defaults (2/10) are fine for a localhost push — low enough that a ~10s talk
#    break isn't aired badly late, high enough to ride out a hiccup. Raise buffer if
#    a segment ever stutters on connect.
voice = input.harbor("dj", port=harbor_port, user="source", password=harbor_password, buffer=2., max=10.)

# 4) Mix the voice with the bed, per the talk-over mode.
#    ON  (talk_over): the bed is amplified by a gain we ramp ourselves, and the voice is simply
#        added on top. `add` mixes only the sources that are ready, and is ready when ANY of them
#        is, so a disconnected harbor contributes nothing and the bed plays at full. normalize is
#        OFF: it would divide by the number of ready sources, halving the bed the moment the DJ
#        speaks and undoing the ramp.
#    OFF (between tracks): a voice-priority fallback. While a segment is connected the mount plays
#        the VOICE ALONE (the bed, including the ident floor, is preempted), so the DJ speaks in
#        true silence; when the push ends it drops back to the bed. The app pauses playout at the
#        track boundary so no track advances underneath during the gap.
#    With no live push either way, the bed simply plays at full.
#
#    This replaced smooth_add, whose open bug (savonet/liquidsoap#3714) is that it fades the bed
#    down but never back up, with a glitch at the end of the voice. Ramping a gain ref ourselves
#    is a few more lines and has no hidden latency of its own, which is also why the leaf sources
#    are the ones that get normalized.
#
#    The ramp follows the harbor's READINESS, not its on_connect/on_disconnect: harbor accepts the
#    connection up to `buffer` seconds before any audio flows, so ducking on connect would open a
#    hole under nothing. is_ready() flips when audio is actually available.
#    NB: no name here shadows anything. `floor` in particular is a Liquidsoap builtin
#    (float -> int), so the bottom of the ramp is `duck_floor`.
def ducked(music_bed, dj_voice) =
  duck_floor = lin_of_dB(duck_gain_db)
  tick_s = 0.025
  # Distance covered per tick so a full 1.0 → duck_floor sweep takes duck_fade_ms.
  step = (1. - duck_floor) * (tick_s * 1000. / duck_fade_ms)
  gain = ref(1.)
  thread.run(
    every=tick_s,
    fun () ->
      begin
        target = if dj_voice.is_ready() then duck_floor else 1. end
        current = gain()
        gain :=
          if current < target then min(target, current + step)
          else max(target, current - step)
          end
      end
  )
  add(normalize=false, [amplify({gain()}, music_bed), dj_voice])
end

programme =
  if talk_over then
    ducked(bed, voice)
  else
    fallback(track_sensitive=false, [voice, bed])
  end

# 5) The lease, applied. Everything above this line is what deadair sounds like; below it is the
# question of whether deadair is saying anything at all.
#
# `switch` with a single case is a source that is simply UNAVAILABLE while the predicate is false,
# so the fallback underneath takes over. track_sensitive=false because the whole point is to cut
# the moment the lease lapses: waiting for a track boundary would keep airing a track nothing is
# driving, and the boundary might be minutes away — or never, if the queue drained.
#
# What is underneath is silence, not the local bed and not a disconnect. The mount stays up and
# the source stays connected, so a listener keeps their connection and hears the station come
# back rather than having to reconnect to a mount that 404'd; and the output stays INFALLIBLE,
# which is what lets it be declared without `fallible=true`.
#
# Note what this deliberately does NOT do: it does not check whether the queue has anything in
# it. Silence while deadair is driving is deadair's business (an item still resolving, a gap it
# meant to leave). Silence because nothing is driving is a different fact, and only this gate
# can tell them apart.
radio = fallback(track_sensitive=false, [switch(track_sensitive=false, [({driving()}, programme)]), blank()])

# 6) Encode to MP3 and push to the Icecast mount.
output.icecast(
  %mp3(bitrate=int_of_string(environment.get("STREAM_BITRATE", default="128"))),
  host        = environment.get("ICECAST_HOST", default="icecast"),
  port        = int_of_string(environment.get("ICECAST_PORT", default="8000")),
  password    = environment.get("ICECAST_SOURCE_PASSWORD"),
  mount       = environment.get("STREAM_MOUNT", default="/live.mp3"),
  name        = environment.get("STREAM_NAME", default="Static Between Stations"),
  description = environment.get("STREAM_DESCRIPTION", default=""),
  genre       = environment.get("STREAM_GENRE", default="Talk"),
  url         = environment.get("STREAM_URL", default=""),
  radio
)
