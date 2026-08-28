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
# after it. The DJ voice is a SECOND request queue (step 3): the app arms a segment
# against a record and this script fires it at the right instant, fetching the audio
# itself over HTTP exactly as it fetches music. The bed is ducked under it by an
# explicit gain ramp (step 4). That ramp replaced smooth_add, which fades the bed
# down but never back up and glitches at the end of the voice
# (savonet/liquidsoap#3714).

# Level and destination, both env-driven, because the only way to see what this process is doing
# has been `docker logs` — which needs a socket the app deliberately does not have, and which an
# operator on Docker Desktop cannot read from a script either. The shim already writes to
# /streamlogs; this puts the engine's own log beside it, where the app's rotating logs and the
# shim's are, so all three can be read on one timeline.
#
# Level 3, and 4 is a thing to raise deliberately and lower again: at 4 the harbor logs every
# header of every control call, and that endpoint is polled continuously, so it wrote a megabyte a
# minute against an ordinary station. It was worth every byte once — it is what showed two app
# processes presenting two DIFFERENT bridge secrets to this port, one of them twenty times a second,
# which no amount of reading either side could have established. Set LOG_LEVEL in radio.env; no edit
# here, and no rebuild.
#
# stdout stays on: `docker logs` is still the right answer for anyone who has the socket, and the
# file is an addition rather than a redirect.
settings.log.level.set(int_of_string(environment.get("LOG_LEVEL", default="3")))
settings.log.stdout.set(true)
settings.log.file.set(true)
settings.log.file.append.set(true)
settings.log.file.path.set(environment.get("LOG_FILE", default="/streamlogs/liquidsoap.log"))

# The image runs as root so the bundled helpers can write their logs. Liquidsoap's init refuses
# root by default; allow it for this local/personal container.
settings.init.allow_root := true

music_dir   = environment.get("MUSIC_DIR", default="/music")

# The harbor PORT, which no longer carries a mount of its own: it exists for the
# /control/* endpoints the app drives the station through (step 2). harbor is one
# server per port, dispatching by path.
#
# There is no "dj" mount any more. It existed because v1's app generated voice audio
# in-process and had bytes to stream in as a live Icecast source; deadair serves its
# segments over HTTP and lets Liquidsoap fetch its own voice the same way it fetches
# its own music, so no audio passes through the app at all. See step 3.
#
# The materializer still writes HARBOR_PASSWORD into radio.env and nothing reads it,
# which is deliberate rather than an oversight: a live input is the obvious thing to
# want back here one day — a real microphone is the honest case — and it would need
# exactly that credential. An unread env key costs nothing; a binding nothing uses
# reads as something somebody forgot to delete.
harbor_port = int_of_string(environment.get("HARBOR_PORT", default="8005"))

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
# it is set.
#
# **`string.to_float`, and NOT `float_of_string(default=null, …) ?? fallback`.** That shape is what
# this was, and it is a misreading of the stdlib that took the station off air: with `default=null`,
# `float_of_string` RAISES `failure("float_of_string")` on anything it cannot parse — the empty
# string included — so the `??` it was paired with is unreachable. 2.4.5's own
# `string.to_float(~default=0., s) = float_of_string(default=default, s)` is the sanctioned form: a
# non-null default is returned rather than raised, and the result is a plain float.
def env_float(name, default) =
  string.to_float(default=default, string.trim(environment.get(name, default="")))
end
duck_gain_db = env_float("DUCK_GAIN_DB", -12.)
duck_fade_ms = max(1., env_float("DUCK_FADE_MS", 300.))

# The operator's trim on the DJ voice, in dB, applied after the mic chain in step 3, on TOP of
# whatever the app decided for the segment itself.
#
# Zero, and it means zero now that it is no longer the only thing holding the voice up: the app
# stamps `liq_amplify` on every cue it arms, from the segment's own level against the station's
# target, and the mic chain applies that per segment. This is the trim left over for an operator
# who has heard the result and wants the DJ a decibel forward of it — not a per-engine correction,
# which is a thing the app now works out for itself.
voice_gain_db = env_float("VOICE_GAIN_DB", 0.)

# The app fills a rundown and PUSHES it here item by item, whichever source the tracks came from:
# a pre-signed Subsonic URL for Navidrome, a signed track-shim URL for Spotify. Switching source
# is therefore an app-side decision that takes effect with NO container restart.
# See stream/README.md + apps/api (stream materializer).
#
# One secret gates traffic in BOTH directions: the app's calls to /control/* here, and our two
# pushes back to the app (aired, starve).
playout_aired_url  = environment.get("PLAYOUT_AIRED_URL", default="")
playout_starve_url = environment.get("PLAYOUT_STARVE_URL", default="")
playout_secret     = environment.get("PLAYOUT_BRIDGE_SECRET", default="")

# Which generation of radio.env this process booted with: a short hash the app writes over the
# file's own content. Reported on every reading and used for nothing else here.
#
# It exists because this file is sourced ONCE, by the entrypoint, and nothing re-reads it — so a
# re-render (a settings change, or a schema rebuild that reseeds every stream secret) leaves this
# process holding a source password and a bridge secret that no longer match anything, and the
# symptoms name something else: the mount simply never connects, and Icecast answers 404. The app
# compares this against what it last wrote and says so in one sentence. Empty from a station whose
# app is too old to write it, which the app reads as "cannot say" rather than as a mismatch.
config_stamp = environment.get("CONFIG_STAMP", default="")

# 1) Music bed: the local, rights-cleared library. randomize so a small library
#    doesn't feel like a tape loop. Normalize here (a leaf source) so user tracks
#    sit at a consistent level under the voice. Unavailable while the dir is empty
#    (handled below).

# What counts as a track in the bed directory. Everything else in there is somebody's
# housekeeping, not programme material: `.gitkeep` (which is why `stream/music/` survives a fresh
# checkout at all), `.DS_Store`, a half-copied `.part`, an `AlbumArt.jpg`.
#
# The point of listing what a track IS rather than muting the decoder is that a real track the
# decoder cannot read stays an error worth reading. A dotfile is never a track, so it is not a
# decode failure to report — it is a file that was never offered. Handing one to `playlist`
# instead costs three decoder errors per scan, forever, on the default state of a fresh checkout.
music_extensions = ["mp3", "flac", "ogg", "oga", "opus", "m4a", "mp4", "aac", "wav", "aiff", "aif", "wma", "wv", "ape"]

def is_bed_track(f) =
  # A leading dot means hidden, not "no extension": OCaml's extension rule already answers "" for
  # `.gitkeep`, and the basename check says the same thing out loud for `.hidden.mp3`.
  not (string.contains(prefix=".", path.basename(f)))
  and list.mem(string.case(lower=true, file.extension(leading_dot=false, f)), music_extensions)
end

# One scan of the bed directory. Empty (or absent) is an ordinary state, not a fault: the station
# then falls through to the bundled ident, which is what a fresh checkout does.
def bed_tracks() =
  if
    file.is_directory(music_dir)
  then
    list.filter(is_bed_track, file.ls(absolute=true, recursive=true, sorted=true, music_dir))
  else
    []
  end
end

# NOTE: reload on a timer, NOT reload_mode="watch". Watch uses inotify, and inotify events do not
# cross Docker Desktop for Mac's host bind mount — a watched playlist only ever reflects what was
# in the dir at container start and never sees files the host drops in later. A wall-timer re-scans
# regardless, so newly dropped tracks are picked up within the interval.
#
# This is `playlist.list` over our own scan rather than `playlist(music_dir)` because the filter has
# to happen when the LIST is built. `playlist`'s own `check_next` hook rejects a candidate after the
# list is built, and its documented failure mode is exactly ours: reject every entry and the source
# spins in a consuming loop instead of going unavailable. Filtering the scan means a bed holding
# nothing but a `.gitkeep` is simply an empty playlist, which is already the state everything below
# is written against. The timer below is the same `thread.run(delay, every, reload)` that `playlist`
# schedules internally for `reload_mode="seconds"`, down to `reload` emptying the prefetch queue;
# only the file list differs.
music_bed = playlist.list(id="music", mode="randomize", bed_tracks())
thread.run(delay=15., every=15., fun () -> music_bed.reload(bed_tracks()))

music = normalize(target=-13., music_bed)

# The station's own name, hoisted because two things need it: the mount's advertised name (step 6)
# and the label the mount carries whenever what is playing is NOT a programme item.
stream_name = environment.get("STREAM_NAME", default="Static Between Stations")

# What the mount is labelled with when a bed track has nothing to say for itself.
#
# The mount's title only ever changes when a source emits metadata. A local file with no tags
# emits none, so without this the label from the LAST programme item simply stays up — a listener
# sees a track that stopped minutes ago and is still being told it is playing. `insert_missing`
# is what forces a packet at the start of every bed track so there is something to fill in.
#
# Existing tags win. A bed track that knows its own title is more useful than the station name,
# and this is only ever filling a hole.
def bed_label(m) =
  if m["title"] == "" then [("title", stream_name)] else m end
end

music = map_metadata(bed_label, insert_missing=true, music)

# The floor UNDER the programme: a bundled station ident/bed. Always available, so a gap inside
# a programme deadair is driving never becomes dead air, and the voice always has something to
# duck. It is not a floor under the station itself — the lease gate below is above all of this.
station_id = map_metadata(bed_label, insert_missing=true, mksafe(single("/radio/station-id.mp3")))

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
# which is exactly the depth the app tops up against. Clearing it goes through `drop_queued` below,
# which removes per request rather than replacing the queue: see there for why the obvious
# `set_queue([])` orphans whatever the prefetch is mid-download.
#
# `prefetch` is what makes an operator skip land AT ONCE, and it is not the same thing as how many
# items the app has pushed. Liquidsoap only ever downloads `prefetch` requests ahead of the one on
# air; everything else pushed sits unresolved. Measured on a real station: ~200ms for a skip onto a
# resolved item, >1.2s and no boundary at all for one onto an unresolved queue.
#
# It is ONE now, down from three, because the app's commitment horizon collapsed to one item: a
# record is not committed until its audio is on the app's own disk, so there is nothing left for a
# deeper lead to hide. The cost was taken deliberately and is the second skip — the first still
# lands at once, and one taken before the replacement resolves does not. See COMMIT_LEAD and
# PLAYOUT_LEAD in apps/api, and docs/decisions/bytes-before-air.md.
#
# PLAYOUT_PREFETCH is materialized by the app from the same constant it uses for its own push lead
# (PLAYOUT_LEAD), because the two are useless apart: pushing more than this resolves buys nothing,
# and this resolving more than is pushed has nothing to work on.
# Through env_float (and back to an int) rather than int_of_string: that one's `default` is
# NULLABLE too, so a literal default would make this an `int?` that nothing downstream accepts.
# Same trap the duck settings hit, same way out.
playout_prefetch = int_of_float(max(1., env_float("PLAYOUT_PREFETCH", 3.)))
playout_queue = request.queue(id="playout", prefetch=playout_prefetch)

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

# How long the item on air has been playing, in seconds, counted UP by a thread.
#
# The same construct as the lease countdown, and for the same reason: it cannot be fooled by the
# container's clock being stepped. It is also the only elapsed measurement in the system that is
# not somebody's estimate — it is reset at the boundary itself, in the loop that produces the
# audio, so a cue timed against it carries no error from the app's clock, from an HTTP round trip,
# or from the encoder and client buffers.
#
# That last one is most of what v1 could never reach. The voice and the bed are mixed BEFORE the
# encoder, so whatever buffering separates the decoder from the listener applies to both equally
# and cancels. Timing the voice against the music in here is exact; timing it against the
# listener's clock from outside has all of that error in it.
#
# **The `cross` further down does not break this, and it needs no correction.** That is worth
# stating because it is not obvious, an earlier version of this file got it wrong in both
# directions, and docs/todo/crossfades.md deferred the whole feature on the belief that it did.
#
# The reasoning that looks right and is not: a cross holds a buffer of the music and the voice is
# mixed in above it, so the bed is delayed and the voice is not, so this counter must be running
# ahead of the audience. What that misses is that this is a WALL CLOCK, not a source position. It
# is zeroed when the `on_track` fires, and the only question is whether that instant is when the
# listener starts hearing the record. It is: with a buffer of L seconds the operator pulls the
# source L ahead, so the source crosses into the next track at output time (its start - L), and the
# overlap is L long, so it BEGINS at the same instant. The counter is zeroed exactly as the record
# becomes audible and both then advance in real time.
#
# The buffer growing or shrinking afterwards, as it re-sizes for the next boundary, moves the source
# pointer and not this clock, so it does not enter into it either.
#
# **It does run about 3% slow**, which is a separate and much smaller thing, measured twice by
# stream/voicecue.check.liq: a break due at 6s landed at 6.22s, one due at 14s landed at 14.48s. The
# cause is right here — this counter ADDS a fixed tick rather than measuring how long a tick actually
# took, and `thread.run` does not fire on the nail. So a talk-up drifts later the further into a
# record it is placed: a fifth of a second at 6s, two thirds at 20s. Tolerable for an intro cue and
# not for anything timed against the end of a record. Fixing it means measuring elapsed time instead
# of counting ticks, which gives up the clock-step immunity the paragraph above is about, so it is a
# trade rather than a bug fix and has not been made.
#
# Measured, not argued: stream/voicecue.check.liq arms a cue 6s into a record with a 4s blend in and
# an 8s blend out. The version of this file that added the blend to the due time landed that break
# at 14.5s -- halfway through the next verse -- and the error was exactly the blend out, which is
# what it was adding. Nothing is added now.
#
# Declared above `playout_note_on_air`, which resets it: Liquidsoap resolves names where they are
# written, so a ref used inside a `def` has to exist before the `def` does.
on_air_elapsed = ref(0.)
voice_tick = 0.1

def voice_countup() =
  on_air_elapsed := on_air_elapsed() + voice_tick
end
thread.run(every=voice_tick, voice_countup)

# Whether the item on the playout queue right now is the station TALKING.
#
# The app stamps `deadair_speech="1"` on a break it pushes down this queue (annotate.ts, SPEECH_KEY)
# and stamps nothing on a record, so an absent key and a record are the same answer, which is what
# the comparison below wants. Read by the compressor in step 2 and by nothing else.
#
# Set in the SYNCHRONOUS hook, like `on_air_elapsed` beside it, because it has to be true before
# the first frame of the item reaches the operator that reads it.
on_air_speech = ref(false)

# The gain stamp EXACTLY as it arrived, for the reading.
#
# Not used to level anything — `amplify` reads the same key itself — and here because the one thing
# nobody could see was what this operator was handed. `liq_amplify` is parsed as
# `Scanf.sscanf " %f dB"` falling back to `float_of_string`, so a value that lost its suffix
# somewhere between the app and here is applied as a LINEAR factor and is silent about it: a stamp
# meaning +7.8 dB becomes a multiplication by 7.8, which is +17.8 dB. Measured off the mount, that
# is what a break has been airing at. A reading that shows the string settles in one look which
# side of the wire dropped it.
on_air_gain = ref("")

def playout_note_on_air(m) =
  on_air_item := m["deadair_item"]
  on_air_speech := m["deadair_speech"] == "1"
  on_air_gain := m["liq_amplify"]
  # Reset HERE, in the streaming loop, which is the whole reason this hook is synchronous: the
  # counter below is what a voice cue is timed against, and starting it anywhere else would start
  # it late by however long an HTTP notify took to arrive.
  on_air_elapsed := 0.
end

# What the app has asked for and has not had yet: the uri to play, the running-order item it is
# timed against, and how far into that item to start speaking.
#
# One at a time, deliberately. A second arm replaces the first rather than queueing behind it: a
# cue is about a particular record, and one that did not fire before that record ended is not
# something to play late, it is something to drop. See voice_cue_check.
voice_uri  = ref("")
voice_item = ref("")
voice_at_s = ref(0.)
# For the reading, so a cue that never fired is visible rather than mysterious:
# "idle" nothing armed | "armed" waiting for its moment | "fired" pushed | "missed" its record ended first
voice_state = ref("idle")

# Whether the record a cue is waiting for has been seen on air yet.
#
# The distinction this exists for: a cue is armed a full item BEFORE its record starts, because the
# app arms it when the item is handed to the player and the player is a whole track ahead of the
# listener. So "the id does not match" means two opposite things — not yet, and already gone — and
# an id alone cannot tell them apart. Without this the cue expires the instant it is armed, every
# time, and the DJ never speaks.
voice_seen = ref(false)

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

# Trim the dead air off the head and tail of each record.
#
# The app stamps `liq_cue_in` / `liq_cue_out` on the `annotate:` uri from the measurements in
# `deadair.track_analysis` (see apps/api/src/modules/playout/annotate.ts).
#
# **There is no operator here any more, and that is not an omission.** 2.4.5 removed `cue_cut` and
# integrated the trim into request resolution, so the keys are applied when the request is resolved
# whether or not anything sits in the graph — the boot log said so on every start:
# "cue_cut has been removed and integrated directly into requests resolution! This operator can be
# safely removed from your script now." It was, in the same pass that fixed the transition crash.
#
# So the warning the previous version of this comment carried is now inverted. It used to be that
# stamping without `cue_cut` was a silent no-op; it is now that ADDING `cue_cut` back would be the
# no-op, and the trim happens regardless.
#
# Placement used to matter in three ways, and the trim moving into request resolution settles all
# three by construction rather than by where a line sits. Kept because each one is still a fact about
# the graph that anything added here has to respect:
#
#   - The level follower never sees the leading silence, so it does not spend the first second of
#     every record recovering from it.
#   - The two `on_track` handlers stay attached to `playout_queue` itself. They report which item
#     started, and that is a fact about the queue rather than about where the audio was cut, so they
#     must not move.
#   - The blend is sized against a TRIMMED record: `cross` reads `remaining()` from a source whose
#     audio is already cut to `cue_out`, so the outro it buffers is the same number the app sized it
#     from. Note also that `cross` presents its output as one never-ending track, so a
#     `track_sensitive` operator ABOVE it never sees another boundary.
#
# An unstamped track passes through untouched, which is the ordinary case: a track the station has
# not measured yet plays exactly as it did before.
#
# One consequence worth knowing, because it moves a clock that DJ breaks are timed against:
# `on_air_elapsed` counts from the track boundary, and with the leading silence gone the boundary and
# the first audible sound now coincide. A voice cue against a record with a long lead-in therefore
# fires closer to where it was meant to. That is a correction rather than a regression, but it IS a
# change, and it is the sort that can only be judged by listening.
playout_bed = playout_queue

# Set each record to the station's level, decided before it aired.
#
# The app stamps `liq_amplify` on the `annotate:` uri from the loudness in
# `deadair.track_analysis` (see apps/api/src/modules/playout/gain.ts, and `annotate.ts` for the
# format). `liq_amplify` is `amplify`'s own default override field, so naming it here is for the
# reader rather than for Liquidsoap; what is NOT decoration is the `dB` suffix on the value, since
# the value is parsed as `sscanf " %f dB"` falling back to `float_of_string` and a bare `-3` would
# be a linear factor of minus three.
#
# It sits after the cue trim and before `normalize` on purpose: the gain is not decided against
# silence, and the follower is handed audio that is already at the target and has nothing left to do.
# The trim is no longer an operator to sit after (2.4.5 does it during request resolution), so the
# ordering that matters here is only the one against `normalize`.
#
# An unmeasured track passes through at 1.0, which is the ordinary case.
playout_bed = amplify(1., override="liq_amplify", playout_bed)

# The stamp has now been spent, so it is REMOVED before anything else can spend it again.
#
# `amplify`'s `override` parameter defaults to `liq_amplify` and a set override REPLACES the factor
# the operator was given rather than multiplying with it, so ANY later `amplify` that does not say
# `override=null` silently applies this record's correction a second time and discards whatever it
# was actually asked to do. That is not a hypothetical about future edits to this file: **Liquidsoap's
# own `normalize` ends in `amplify(id=id, {v()}, …)` with no `override`** (`src/libs/audio.liq`), so
# the follower thirty lines below was re-applying the stamp on every measured record and throwing its
# own computed gain away. Measured off the mount: a record stamped -5 dB aired 5 dB below where it
# was sent, and the whole library sat around ten decibels under the breaks.
#
# Removing the key is the fix rather than `override=null` on each operator, because only this scales:
# the offender was inside the standard library where there is no argument to pass, and the next one
# will be too. Everything downstream that legitimately wants a per-item gain has already had it.
#
# `update=true` keeps every other key — `liq_cross_*` is read by `cross` further down, and the title
# and artist are what the mount is labelled with — and an empty value is how `metadata.map` spells
# "delete this one" (`strip`, on by default: `else Frame.Metadata.remove x m`). The two `on_track`
# handlers that report the stamp for the reading are attached to `playout_queue` ABOVE this, so what
# an operator sees in `/control/status` is still exactly what the app sent.
playout_bed = metadata.map(update=true, strip=true, fun (_) -> [("liq_amplify", "")], playout_bed)

# The mic chain's compressor, for the half of the breaks that never reach the mic chain.
#
# A break has two routes to the mount and until now only one of them was processed. Over a record it
# is a cue on the voice queue and goes through `voice_bus` below, which compresses it. BETWEEN two
# records it is an ordinary running-order item and comes down HERE, where the only thing between it
# and the encoder was the `amplify` above and the bus limiter at the bottom of the file.
#
# That is audible, and it is the opposite of what the numbers say. Measured off the station's own
# files: the speech engine lands at about -26 LUFS with true peaks around -3 to -7 dBFS, which is a
# crest factor no record has. Levelling it by loudness alone (`speechGainFor`, +8.5 dB today) puts
# the BODY of the voice a little under the records either side and its plosives at +5 dBFS, six
# decibels into a limiter the records never touch — where a record measured at -7.6 LUFS is cut to
# -16 and peaks around -6. So the bus limiter was doing the levelling for one source only, and a
# voice that is being brickwalled reads far louder than its own loudness figure. Trimming the gain
# barely moved it, because the limiter simply worked less.
#
# The settings are the mic chain's, deliberately identical (see step 3 down there for what each one
# is for). The two paths are the same audio and disagreeing about how to treat it is how a station
# ends up with a DJ who sounds like two different people either side of a record.
#
# Per ITEM rather than per source, because this queue carries records too and a compressor that
# suited both would suit neither: at -18 and 4:1 a record at the station's level is inside the
# threshold from its first bar. `ratio` is a getter, so the switch is `4:1 while the item is a
# break, 1:1 otherwise` — and 1:1 is not an approximation of off, it is off: the reduction is the
# distance over the threshold divided by the ratio.
#
# Placement mirrors the mic chain: AFTER the app's `amplify`, because a fixed threshold only means
# anything against an input the app has already levelled, and BEFORE `normalize`, which is cut-only
# and now sees a break whose peaks are already in order.
playout_bed = compress(
  attack=5.0,
  release=120.0,
  threshold=-18.0,
  ratio={if on_air_speech() then 4.0 else 1.0 end},
  knee=2.0,
  gain=0.0,
  playout_bed)

# The follower, which is now the fallback for what the station has not measured rather than how the
# station is levelled.
#
# Every argument past `target` is here because the default follower is audibly wrong on records
# that end quietly. Measured on air: the closing fade of a track is a level falling for tens of
# seconds, and a follower reads that as a record that needs lifting, so it rides the gain UP as the
# music leaves and the fade gets LOUDER the quieter it was meant to become.
#
#   threshold  -25 rather than -40: below this the gain is held rather than chased. A fade, a
#              quiet intro and a long outro all live between the two numbers, and none of them is
#              a record that needs turning up.
#   up         30 rather than 10 seconds, so nothing it does can happen inside one passage of a
#              record. It is there to correct a track, not to follow one.
#   gain_max   0, so the follower can only ever pull DOWN. There is then no elevation for a
#              boundary to carry, which is the half of the old fault that WAS the lift.
#   track_sensitive
#              false, and this is the other half. See below.
#
# `gain_min` is left alone: pulling a loud unmeasured record down is the half of this that was
# never audible as a fault.
#
# **`gain_max` was 6 and bounding the lift was not enough, and `track_sensitive` is why.** The
# argument written here for as long as this operator existed was that this is ONE operator over the
# whole queue, so its gain state is continuous across a track boundary. Read against 2.4.5's
# `normalize` in `src/libs/audio.liq`, that is FALSE and always was: `track_sensitive` defaults to
# true and installs `on_track(fun (_) -> v := 1.)`, so the gain snaps to unity at every boundary.
# With `gain_max=0.` unity is the loudest this operator can ever be, so the snap is always UPWARD —
# every record now begins at the top of the follower's range and is pulled back down over `down`
# (a tenth of a second, its default), while the RMS smoother behind it is not reset and is still
# reading the tail of the record that just ended. A record that follows a fade therefore opens at
# full level, held there until the smoother catches up. That is the surviving half of "loud at the
# beginning and end of every track", and under a crossfade it is heard as the transition swelling:
# the outgoing tail is riding whatever cut it had earned while the incoming record is mixed in with
# no cut at all.
#
# `track_sensitive=false` is what makes the sentence above true rather than merely written down.
# The reset it removes cannot be the safety it looks like, because the only state to carry is a CUT
# and a cut is released by `up`, deliberately over thirty seconds, and never inside a fade — below
# `threshold` the gain is held rather than chased.
#
# At `gain_max=0.` there is no elevation to carry across either, and that costs nothing this station
# can hear: every record it has measured falls between -18.5 and -4.9 LUFS, averaging -9.5, so
# nothing in the library is quiet enough to want lifting towards -13 and the up half of the follower
# had no legitimate work to do here.
#
# What is left is the honest half of the fallback, which is holding down an unmeasured loud master
# until it has been measured. When coverage is complete this operator comes out of the chain
# entirely and `gain.ts` is the whole level policy.
#
# **It only started doing that job once the stamp was stripped above.** `normalize` ends in
# `amplify(id=id, {v()}, …)` with no `override=null` (`src/libs/audio.liq`), so on any record
# carrying `liq_amplify` this operator was not normalizing at all: the override replaced `{v()}`
# outright, the follower's own gain was computed and discarded every frame, and what came out was
# the app's correction applied a second time. Everything the block above says about `up`,
# `threshold` and `gain_max` was therefore true of unmeasured records only, which is exactly the
# half nobody was listening to.
#
# One consequence to keep in mind now that it is live: `target` here is an RMS figure and
# `playout.targetLufs` is a loudness one, so the two agree in name rather than in units. A record
# levelled to -13 LUFS lands a decibel or three either side of -13 dBFS RMS depending on how bright
# it is, and this being cut-only means the bass-heavy end of the library can still be trimmed a
# little below where `gain.ts` sent it. That is bounded and quiet; it is not the same operator
# fighting the static gain the way an up-and-down follower would.
#
# These numbers can only be judged by listening, and they are a first answer rather than a tuned one.
playout_bed =
  normalize(target=-13., threshold=-25., up=30., gain_max=0., track_sensitive=false, playout_bed)

# Blend one record into the next.
#
# The app stamps `liq_cross_duration` on the `annotate:` uri from the cue points in
# `deadair.track_analysis` (see apps/api/src/modules/playout/crossfade.ts for how the length is
# decided, and annotate.ts for the format). The length is `min(outgoing.outro, incoming.intro)`, so
# a record that ends cold is barely ridden and one that fades is ridden only as far as the next
# record's intro can absorb it. Nothing here decides how long a blend is; this decides what happens
# during one.
#
# Placement: ABOVE `normalize`, so the two records being blended are each already at the station's
# level and the follower is never chasing a mixture. Below the `on_track` handlers, which stay on
# `playout_queue` and report what the queue did rather than what the listener heard.
#
# Four things about `cross` on 2.4.5, each of which is silently wrong rather than loud if missed.
#
#   1. The low-level `cross`, NOT the `crossfade` wrapper. `crossfade` routes through its own
#      internal transition and a custom one passed to it appears to do nothing, with no error.
#   2. `persist_override=true`. Without it the override is reset before it sizes the stamped track's
#      own end-of-track buffer, so a per-item duration is accepted and then not used. The flip side
#      is that a stamp LINGERS over later unstamped tracks, which is why the app stamps every item
#      including the ones it does not blend.
#   3. The fade must span the ENTIRE buffer. A fade shorter than what `cross` buffered leaves the
#      outgoing track at full level while the incoming ramps in, which sums to about +6 dB and is
#      audible as a lurch on every transition. So the fades below are the buffer, both of them, and
#      to vary a blend you vary the buffer.
#   4. `cross` presents its output as ONE never-ending track. Anything `track_sensitive` placed
#      above it never sees another boundary. The bed fallback and the lease gate are both
#      `track_sensitive=false` already, so this changes nothing today, and it is the trap for
#      anything added above here later.
#
# One thing it costs, deliberately unfixed: `playout_reading()` reports `playout_queue.remaining()`,
# which is measured BELOW this and so runs ahead of the listener by whatever is buffered. It is a
# display figure that nothing schedules against (see NowPlaying.remainingMs), so it is left alone
# rather than corrected into a second number that could disagree with the first.
# The two metadata keys the app stamps a blend length on. Liquidsoap's own names, and both are
# `cross`'s own defaults. Declared up here rather than beside the operator for the same reason
# `on_air_elapsed` is: `playout_note_on_air` below reads one of them.
#
# TWO keys and not the combined `liq_cross_duration`, which was the first attempt and is a trap.
# **A boundary is made of two tracks, and the combined key sets BOTH ends of ONE track.** So the
# outgoing record says "blend 4 seconds" about the boundary after it while the incoming record says
# "blend 0.1" about the boundary after IT, the operator applies both to the same transition, and the
# shorter one wins. Measured: every boundary collapsed to a hard join because whichever record came
# next was not itself blending.
#
# Split, each boundary's length is stamped twice and the two agree: on the outgoing record as its
# END buffer, on the incoming record as its START buffer.
playout_cross_out_key = "liq_cross_end_duration"
playout_cross_in_key = "liq_cross_start_duration"

# What a boundary the station does not blend is stamped with, and it is deliberately NOT zero.
#
# Read against 2.4.5's cross.ml: with a duration of zero, `buffer_before` never appends a frame, so
# it never sees the end of the track, so it never advances to `analyze_after`, and the buffered
# source it hands out is never ready. The operator stops producing entirely and the station falls
# through to the local music bed for good. A tenth of a second is several frames, which is enough to
# keep the state machine moving, and it is a hard join in every way a listener can tell.
#
# Must match HARD_JOIN_MS in apps/api/src/modules/playout/annotate.ts.
playout_cross_hard_join = 0.1

# How long the boundary OUT of a record is, off its own metadata.
#
# `string.to_float` for the reason `env_float` gives at the top, and THIS is the site where getting it
# wrong was fatal rather than latent: the key is absent on anything the app did not stamp — the local
# music bed, a hand-pushed uri, anything queued by something other than `PlayoutPusher` — and every
# boundary runs this from inside `cross`'s transition callback. A raise there is not caught: it comes
# out through `Cross.cross#create_after`, up through `Output.output#output`, and kills the clock
# thread, which takes the whole process down and the mount with it. Measured on 2026-08-12: a station
# that aired one item after every restart and crashed on the second, ~65 times.
def playout_cross_duration(m) =
  string.to_float(default=playout_cross_hard_join, string.trim(m[playout_cross_out_key]))
end

# What happens during the overlap.
#
# Equal-power, which is the plain rung and the whole of it. The louder-sounding alternatives (a
# filter sweep on the outgoing record, a bass handover that switches once rather than crossfading)
# need a per-transition filter chain rather than one on the bus, and they are not built. See
# docs/todo/crossfades.md.
#
# **`type="log", curve=6.4` and NOT `type="sin"`, which is not what its name suggests.** Liquidsoap's
# `sin` shape is `(1 + sin((x - 0.5) * pi)) / 2`, a raised cosine that passes through 0.5 amplitude
# at the midpoint. Like `lin`, it is COMPLEMENTARY — the fade out is one minus the fade in — and any
# complementary pair sums to half power in the middle, which is a 3 dB hole in the centre of every
# blend. Measured on a rendered transition, not inferred: -3.08 dB.
#
# `log` and `exp` are not complementary, so they can do better. Sweeping the curve for the flattest
# combined power puts `log` at 6.4, worst deviation 0.12 dB across the whole overlap, which is equal
# power for any purpose a listener has. The default curve of 10 would give 0.48 dB and is also fine;
# 6.4 is here because it was free once the sweep was written. `exp` cannot do it at any curve.
#
# `sequence` rather than a fade when there is nothing to blend, which is the ordinary case for an
# unmeasured record, for an album, and for either side of one of the station's own segments. It
# plays the buffered tail and then the next record, which is exactly what the station did before
# any of this existed.
def playout_transition(a, b) =
  blend = playout_cross_duration(a.metadata)
  if
    blend <= playout_cross_hard_join
  then
    sequence([a.source, b.source])
  else
    add(
      normalize=false,
      [
        fade.in(type="log", curve=6.4, duration=blend, b.source),
        fade.out(type="log", curve=6.4, duration=blend, a.source)
      ]
    )
  end
end

# `duration` here is only the buffer before the FIRST stamp is read, so it is the hard join rather
# than the operator's own five-second default: the whole stream runs this far behind the decoder,
# and five seconds of that at startup is five seconds of nothing on the mount.
playout_bed =
  cross(
    duration=playout_cross_hard_join,
    override_end_duration=playout_cross_out_key,
    override_start_duration=playout_cross_in_key,
    persist_override=true,
    playout_transition,
    playout_bed
  )

# ── Playout control endpoints ────────────────────────────────────────────────────────────────
# Registered on the harbor port, which carries nothing else, and gated on
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

# ── The dead-man switch ──────────────────────────────────────────────────────────────────────
# deadair is the station. Nothing else here is allowed to be: this script owns a local music
# library and a bundled ident, and without a gate BOTH of them keep the mount playing after the
# app has stopped driving — a crash, a deploy, a restart that lost the running order. That is
# sound nobody chose, coming out of a station whose entire premise is that the app chooses.
#
# So control is a LEASE, not a state. The app renews it by calling /control/onair (defined below,
# with the other handlers), and everything it does not renew expires on its own. A dead app cannot
# hold the station by inertia, and there is no failure mode where "the app stopped talking to us"
# is mistaken for "carry on".
#
# The state lives up here rather than beside its endpoints because `playout_reading` reports it
# and Liquidsoap is sequential: a predicate defined after its use does not resolve.
#
# CONTROL_TTL_S has to comfortably exceed the app's reconcile interval (2s), or an ordinary slow
# tick would take the station off air. Six seconds is three ticks.
control_ttl = max(1., env_float("CONTROL_TTL_S", 6.))

# Seconds of lease left, counted DOWN by a thread rather than compared against a wall clock. Same
# construct the duck ramp uses, and it cannot be fooled by the container's clock being stepped.
# Starts at zero: a Liquidsoap that comes up before the app is not being driven by anything yet,
# and must not pretend otherwise.
lease_left = ref(0.)
lease_tick = 0.5

# A named def, not an inline lambda: a `:=` assignment is a statement rather than an expression, so
# as a bare lambda body it does not parse and the error lands far downstream (see the note on
# playout_note_on_air above, which is the same trap).
def lease_countdown() =
  lease_left := max(0., lease_left() - lease_tick)
end
thread.run(every=lease_tick, lease_countdown)

def driving() =
  lease_left() > 0.
end

# ── Starve reporting ─────────────────────────────────────────────────────────────────────────
# Tell the app the moment its running order stops producing audio, and the moment it starts again.
#
# `playout_queue.is_ready()` going false while the lease is held is a specific and bad state: the
# station IS on air, and the fallback below the queue has put the local music bed on the mount, so
# what a listener hears is not what deadair programmed. The app cannot see it for itself with any
# precision — its reconcile runs every two seconds, so a gap shorter than that never appears in any
# reading it takes, and one starting just after a tick is noticed two seconds late.
#
# Reported ONLY while driving(). A queue with nothing in it and no lease is the ordinary off-air
# state — the app deliberately hands over nothing when nobody is listening — so treating that as a
# starve would fire on every stop and mean nothing.
#
# What is watched is the GAP itself — driving AND not producing — rather than "is it producing".
# The difference is the whole correctness of this block. Producing goes false for two completely
# different reasons: the queue ran dry under a held lease, which is the fault worth reporting, and
# the operator stood the station down, which is not a fault at all. Only the first has the lease
# still held, so conditioning the watched value on `driving()` makes a stop a non-event instead of
# a starve reported on every Stop button.
#
# Seeded false, which is what a mixer that has just started is: nothing is driving it, so there is
# no gap. It also means a station coming up reports nothing until something actually goes wrong.
in_gap = ref(false)

# How long the CURRENT state has held, counted up by the same tick that detects the change, for the
# reason every other duration in this file is counted rather than subtracted from a clock: it cannot
# be fooled by the container's clock being stepped.
gap_state_for = ref(0.)

# An empty URL means "do not report", the same way an empty PLAYOUT_AIRED_URL does, so a stream
# pointed at an app too old to serve the route falls back to that app's own polling instead of
# logging a 404 per gap.
#
# NEVER let this raise. An uncaught exception inside a thread.run callback kills that thread
# permanently, which here would mean the reporting goes quiet and looks exactly like a station with
# no gaps. The `http.post` is also blocking, so a hung app delays the next check — never the lease,
# which is counted down by its own separate thread.
def report_starve(state, held_s) =
  if playout_starve_url != "" then
    try
      ignore(
        http.post(
          data="",
          headers=[("X-Playout-Secret", playout_secret)],
          "#{playout_starve_url}?state=#{state}&forMs=#{int_of_float(held_s * 1000.)}"
        )
      )
    catch err do
      log(label="deadair", "starve notify failed (#{err})")
    end
  end
end

# On the lease tick, so this cannot disagree with the `driving()` it is conditioned on: a second
# clock would only ever be a source of edges the lease itself did not see.
#
# The duration reported is how long the state being LEFT lasted, so a `recovered` carries the length
# of the gap — the number worth reading — and a `starved` carries how long the station had been
# playing properly before it.
#
# Note that a gap ends when the queue produces again OR when the lease is handed back, and both are
# reported the same way. That is deliberate: an operator stopping a starving station has ended the
# gap, and the alternative is a starve that stays open forever because the thing it was waiting for
# never happened.
def watch_starve() =
  gap = driving() and not playout_queue.is_ready()
  if gap == in_gap() then
    gap_state_for := gap_state_for() + lease_tick
  else
    report_starve(if gap then "starved" else "recovered" end, gap_state_for())
    in_gap := gap
    gap_state_for := 0.
  end
end
thread.run(every=lease_tick, watch_starve)

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
#   driving      whether deadair's lease is unexpired, i.e. whether ANY of this is reaching the
#                mount. The others describe the queue; this one describes the station.
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
  # Whether any of the above is actually being HEARD. Everything else in this reading describes
  # the queue, which goes on producing whether or not the gate above it is open — so without this
  # field "the queue is playing" and "the station is on air" are indistinguishable from outside,
  # and the console can only guess which one it is looking at.
  driving_json = if driving() then "true" else "false" end
  # What the armed voice cue is doing. Reported for the same reason `onAir` is: the app would
  # otherwise have to infer it, and the one state worth seeing — a cue that expired because its
  # record ended first — is invisible from outside by construction. Every /control/* handler
  # answers with this reading, so it costs no extra call.
  # Which radio.env this process booted with. Constant for the life of the container, which is the
  # entire point: the app compares it against the file as it stands now, and a difference means
  # everything below is being done with credentials that have been replaced.
  # What the mixer thinks it is playing, and what it was told to do about the level. Both are
  # exactly what arrived on the item's own metadata: `speech` is what switches the compressor in
  # step 2, and `gain` is the raw `liq_amplify` string, suffix and all. A stamp that lost its
  # `dB` on the way here is applied as a linear factor and looks like nothing at all from the app
  # side, which is a difference of ten decibels reported as a difference of none.
  speech_json = if on_air_speech() then "true" else "false" end
  '"queued": #{playout_queue.length()}, "ready": #{ready_json}, "onAir": "#{item}", "remainingMs": #{remaining_ms}, "driving": #{driving_json}, "voice": "#{voice_state()}", "speech": #{speech_json}, "gain": "#{on_air_gain()}", "configStamp": "#{config_stamp}"'
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

# Drop everything the queue is holding that has not aired, one request at a time.
#
# NOT `set_queue([])`, which looks like the obvious way to say this and is a trap. `request.queue`
# wraps a `request.dynamic`, and `set_queue` replaces that inner queue wholesale — but a request the
# prefetch has already POPPED, and is currently downloading, is in neither the pending list nor the
# resolved one while its fetch runs. The wholesale replace therefore does not remove it; it orphans
# it, leaving a request nothing will ever play and a temp file nothing will ever clean up. With
# PLAYOUT_PREFETCH at 3 there are up to three requests in that window at any moment.
#
# Removing per request avoids the window entirely: whatever `queue()` returns is what is there, and
# anything mid-resolve is simply not in the list to be mishandled. `destroy` then releases the
# downloaded file now rather than leaving it for Liquidsoap to notice as leaked.
#
# What the app sees is unchanged — everything queued is dropped, whatever is on air keeps playing —
# so this is not a change to the /control/flush contract.
def drop_queued() =
  q = playout_queue.queue()
  list.iter(fun (r) -> playout_queue.remove(r), q)
  list.iter(fun (r) -> request.destroy(r), q)
end

def control_flush(req) =
  if control_authorized(req) then
    drop_queued()
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

# The lease's two endpoints. The state they move, and the `driving()` predicate that reads it,
# are defined further up — `playout_reading` reports it, and Liquidsoap is sequential.
#
# Renew, and answer with the reading like every other control call — so the app's own heartbeat
# doubles as the poll it was already making, and the lease costs no extra request.
def control_onair(req) =
  if control_authorized(req) then
    lease_left := control_ttl
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
    lease_left := 0.
    drop_queued()
    playout_queue.skip()
    # An armed cue belongs to a record that is no longer going to air. Left alone it would sit
    # there until something else armed over it, and the reading would keep claiming the DJ was
    # about to speak.
    voice_uri   := ""
    voice_item  := ""
    voice_seen  := false
    voice_state := "idle"
    control_json('{' ^ playout_reading() ^ '}')
  else
    control_denied()
  end
end

# Arm the DJ over a record: the uri to play as the body, and which record to time it against in
# the headers.
#
# Headers rather than a parsed body, and a body carrying only the uri, so this handler uses exactly
# the same two primitives every other one here does — `list.assoc` over req.headers, and
# req.body() — instead of introducing string parsing into a script whose failure mode is the
# station not coming back up.
#
#   x-voice-item  the running-order item id this is timed against, as it appears in `onAir`
#   x-voice-at-ms how far into that record to start speaking
def control_voice_arm(req) =
  if not control_authorized(req) then
    control_denied()
  else
    uri = string.trim(req.body())
    item = list.assoc(default="", "x-voice-item", req.headers)
    # `string.to_float`, per `env_float` at the top: a missing or malformed header is an ordinary
    # request to reject below, and the old `default=null` shape raised on it instead.
    at_ms = string.to_float(default=0., string.trim(list.assoc(default="", "x-voice-at-ms", req.headers)))
    if uri == "" or item == "" then
      http.response(status_code=400, content_type="text/plain", data="need a uri and an item")
    else
      voice_uri   := uri
      voice_item  := item
      voice_at_s  := at_ms / 1000.
      voice_seen  := false
      voice_state := "armed"
      control_json('{' ^ playout_reading() ^ '}')
    end
  end
end

# Forget an armed cue. What an operator's Stop needs, and what the app sends when the record a cue
# was timed against is no longer going to air.
def control_voice_clear(req) =
  if control_authorized(req) then
    voice_uri   := ""
    voice_item  := ""
    voice_seen  := false
    voice_state := "idle"
    control_json('{' ^ playout_reading() ^ '}')
  else
    control_denied()
  end
end

harbor.http.register.simple(port=harbor_port, method="GET", "/control/status", control_status)
harbor.http.register.simple(port=harbor_port, method="POST", "/control/voice/arm", control_voice_arm)
harbor.http.register.simple(port=harbor_port, method="POST", "/control/voice/clear", control_voice_clear)
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

# 3) Voice: the station's on-air DJ, as a SECOND request queue the app arms and this script
#    fires. Like the playout queue it is failable — empty means "not available" — which is what
#    both mixes below key off, so the bed ducks only while a segment is actually playing and lifts
#    the instant it ends. That is the same contract the harbor input had, without the harbor.
#
#    This replaced input.harbor("dj", ...). v1 streamed rendered audio in over the Icecast source
#    protocol because its app GENERATED the audio in-process and had bytes in hand. deadair serves
#    segments over HTTP instead, so Liquidsoap can fetch its own voice exactly the way it fetches
#    its own music, and no audio passes through the app at all. Bring the harbor input back as a
#    second arm here if something ever genuinely needs to stream live audio in — a real microphone
#    is the honest case — but nothing does today, and an unused mount is a thing that rots.
#
#    THE TIMING, which is the whole point of the arm/fire split below. The app does not decide
#    WHEN the DJ speaks; it says what to say and against which item, and this script picks the
#    instant. That is not a preference. v1 timed breaks in the app against a projected playhead and
#    was audibly wrong, because three errors stack up there: the playhead reading is a couple of
#    seconds stale, the decoder leads the listener by the encoder and client buffers, and a push is
#    not a start. Deciding in here removes all three — the elapsed counter is reset at the boundary
#    itself, and voice and bed are mixed before the encoder so the buffering that separates the
#    decoder from the listener applies to both and cancels.
voice = request.queue(id="voice", prefetch=1)

# Fire the armed cue when the item it belongs to has been playing long enough.
#
# The bed has to be DOWN before the first word rather than during it, so the duck's own ramp is
# subtracted: asking to speak eight seconds in means starting the ramp at eight seconds minus the
# fade, not hearing the fade start under the first syllable.
#
# A cue whose moment has already passed is dropped rather than fired late. Late is worse than never
# here: a back-announce that lands over the next record's vocal is a fault every listener hears,
# while one that is silently dropped is a break nobody knew was coming. The same goes for a cue
# whose record was skipped or never started — the item id stops matching and it expires with it.
# The two branches, spelled out here rather than as comments inside them, because every `if` in
# this file is a plain then/else with no comment in either arm and this is not the file to be
# adventurous in:
#
#   playing    the record this cue belongs to is the one on air. Note the moment is passed once
#              rather than tested against a clock, so `voice_seen` latches and the second branch
#              becomes reachable.
#   not playing, but seen already
#              it was playing and now it is not: the record ended, or an operator skipped it. The
#              cue is DROPPED rather than fired late. Late is the worse of the two by a distance —
#              a back-announce landing over the next record's vocal is a fault every listener
#              hears, while one silently dropped is a break nobody knew was coming.
#   not playing, not seen yet
#              the ordinary state for most of a cue's life. It was armed a whole record early, so
#              it waits.
def voice_cue_check() =
  if voice_state() == "armed" then
    playing = playout_queue.is_ready() and on_air_item() == voice_item()
    # ONE correction, the duck's own ramp, so the bed is down before the first word rather than
    # during it. Deliberately nothing for the crossfade: see the note on `on_air_elapsed` for why a
    # cross needs none, and stream/voicecue.check.liq for the measurement that settled it.
    due = on_air_elapsed() >= max(0., voice_at_s() - duck_fade_ms / 1000.)
    if playing then
      voice_seen := true
      if due then
        voice.push(request.create(voice_uri()))
        voice_state := "fired"
      end
    else
      if voice_seen() then
        voice_state := "missed"
      end
    end
  end
end
thread.run(every=voice_tick, voice_cue_check)

# The mic chain: what makes a rendered segment sound like a voice on a radio rather than a file
# somebody played.
#
# It exists because the level of a segment is otherwise entirely whatever the renderer produced. The
# duck depth below is a fixed number of dB, so it only lands the voice where it belongs if the voice
# arrives somewhere predictable; a quiet engine disappears under the bed and a hot one clips into the
# limiter. Nothing upstream can fix that for us — the engine is a plugin, and a new one is expected —
# so the correction belongs here, on the one path every segment takes.
#
# A NEW name, for the same reason `bus` is one at the bottom of the file: `voice_cue_check` above
# pushes onto `voice`, and rebinding it here would leave the cue pushing into a queue that is no
# longer in the graph. The wrappers delegate `is_ready()` to the queue underneath, which is what both
# mixes in step 4 key off, so the duck still follows the segment and not the operators around it.
#
# Order is load-bearing:
#
#   1. fade.in, 40ms. Some engines cut the audio hard at the clip boundary, and the compressor's
#      makeup gain turns that edge into an audible tick. It runs FIRST so the compressor never sees
#      the raw edge, and it is short enough not to soften the first word.
#
#      fade.in ONLY, and there can be no matching fade.out. On a `request.queue` source this build
#      does not know the remaining time, so fade.out treats the WHOLE clip as inside the fade zone
#      and multiplies it to silence — every segment airs as dead air. A tail click has to be faded
#      at render time instead, where the length is known.
#
#   2. amplify, override="liq_amplify" — the app's own decision about THIS segment, stamped on the
#      `annotate:` uri the cue was armed with, exactly as it stamps one on every record pushed to
#      the playout queue. It is what actually lands the voice at the station's level, and it is
#      here rather than after the compressor because it is the thing that MAKES the input
#      consistent: the compressor's threshold is a fixed number, so a segment arriving three
#      decibels low is a segment being compressed three decibels less.
#
#      An unstamped push is left alone (`amplify(1., …)`), which is the ordinary state for a
#      station whose app is older than this. The app stamps every cue, so it should not arise.
#
#   3. compress. Fast attack and a gentle ratio: it tames the peaks a speech synthesiser puts on
#      plosives and brings the body of the voice forward, without the pumping a broadcast-depth
#      ratio would give a source that is nothing but speech.
#
#   4. amplify, the operator trim. Last, so the compressor sees a consistent input and the knob
#      moves the finished voice rather than how hard it is being worked.
#
#      `override=null` is load-bearing and is NOT the same as leaving it out. `amplify`'s override
#      parameter DEFAULTS to "liq_amplify" (settings.amplify.override), and when an override is set
#      the operator uses it INSTEAD of the factor it was passed — `k = match override with Some o ->
#      o | None -> coeff ()`. So a bare `amplify(x, s)` anywhere below step 2 applies this segment's
#      stamp a SECOND time and silently discards `x`. Measured off the mount before it was disabled:
#      a break stamped +8.7 dB aired at -7.9 LUFS against a design target of -18, hard into the bus
#      limiter, while VOICE_GAIN_DB did nothing at all because it was the discarded factor.
voice_bus = fade.in(duration=0.04, voice)
voice_bus = amplify(1., override="liq_amplify", voice_bus)
voice_bus = compress(attack=5.0, release=120.0, threshold=-18.0, ratio=4.0, knee=2.0, gain=0.0, voice_bus)
voice_bus = amplify(lin_of_dB(voice_gain_db), override=null, voice_bus)

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
  #    `override=null` is load-bearing here for the same reason it is in the mic chain, and this is
  #    the site where getting it wrong cost the most. `amplify`'s override DEFAULTS to "liq_amplify",
  #    and a set override REPLACES the factor rather than multiplying with it, so a bare
  #    `amplify({gain()}, music_bed)` did two things at once: it applied each record's stamp a SECOND
  #    time, and it threw the duck ramp away, since the ramp IS the discarded factor. Measured off
  #    the mount: records aired at `-16 + stamp` rather than at -16 — -26.3 LUFS against a -7.9 LUFS
  #    break — and no stamped record ever ducked under the voice.
  add(normalize=false, [amplify({gain()}, override=null, music_bed), dj_voice])
end

programme =
  if talk_over then
    ducked(bed, voice_bus)
  else
    fallback(track_sensitive=false, [voice_bus, bed])
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

# The label, when the station is not saying anything.
#
# Silence has no track boundaries, so nothing downstream ever emits metadata for it and the mount
# keeps whatever it was last told — the last programme item, indefinitely. A listener still
# connected watches a track that ended minutes ago, and anything reading the mount to find out
# what is on (a hi-fi display, a station page, a scraper) is told the same untruth.
#
# So the transition into silence is announced explicitly. `insert_metadata` puts a packet into the
# stream at the current position rather than at a boundary, which is the only way to label a
# source that has none.
radio = insert_metadata(radio)

# Deliberately seeded as if the station had been driving, so the FIRST tick after startup labels
# a freshly started mount with the station name instead of leaving it blank until something airs.
was_driving = ref(true)

def label_when_off_air() =
  now = driving()
  if was_driving() and not now then
    radio.insert_metadata([("title", stream_name), ("artist", "")])
  end
  was_driving := now
end

# On the same tick as the lease countdown: the lapse this reacts to is measured there, and a
# second clock would only disagree with it.
thread.run(every=lease_tick, label_when_off_air)

# The label, when the station IS saying something.
#
# Metadata only reaches a listener by riding a track boundary the OUTPUT can see, and this graph
# has two switches that deliberately move mid-track: the bed fallback, and the lease gate above
# it. `track_sensitive=false` is what makes them cut immediately, and it is also why they carry no
# boundary — so a packet emitted while another branch is selected is simply dropped, and the mount
# keeps whatever it was last told. Measured on a live mount: the title lagged the running order by
# two items and then stopped moving altogether, while the audio was correct throughout.
#
# So the app announces rather than relying on propagation. It is the one that knows what started
# (on_track tells it, through PLAYOUT_AIRED_URL) and this puts that into the stream at the current
# position, which is the whole point of `insert_metadata` and the only way to label a source whose
# boundary has already passed.
#
# Registered down here because it needs `radio`, which is defined above it. Liquidsoap is
# sequential; the other /control endpoints are declared where their own state is.
def control_metadata(req) =
  if not control_authorized(req) then
    control_denied()
  else
    caption = string.trim(req.body())
    if caption == "" then
      http.response(status_code=400, content_type="text/plain", data="no label")
    else
      # ONE finished line, not a title/artist pair. Icecast composes the ICY title from
      # the pair and reports the result as a single field anyway (see annotate.ts), so a
      # pair here would buy nothing and cost this endpoint a body format to get wrong.
      # The artist is cleared for the reason the off-air label clears it: leaving the
      # previous one standing under a new title is its own kind of wrong.
      radio.insert_metadata([("title", caption), ("artist", "")])
      control_json('{' ^ playout_reading() ^ '}')
    end
  end
end

harbor.http.register.simple(port=harbor_port, method="POST", "/control/metadata", control_metadata)

# 6) The broadcast bus, then the mount.
#
# The bus is a brick-wall ceiling, and NOTHING else.
#
# This is a safety net, not a tone tool, and the distinction is the whole reason it is only one
# operator. MP3 encoding generates inter-sample peaks around 0.5-1 dB above the source, so a modern
# master sitting at ~-0.3 dBFS true peak clips in the LISTENER'S decoder even though nothing here
# ever went over. A -1 dBFS ceiling leaves the headroom the encoder needs. In ordinary programme it
# does nothing at all: typical gain reduction is 0 dB, and it is audible only on material that would
# otherwise have distorted.
#
# What must NOT be added alongside it: a loudness normaliser, a stereo widener, a bus compressor.
# Every one of them reshapes masters that are already mastered, and the station has no editorial
# claim on how a record sounds. Per-track levelling belongs on the LEAF sources, where the static
# `amplify` and the `normalize` behind it already sit, so tracks arrive at a consistent level and
# this stage only has to catch the peaks. The static gain makes that more true rather than less:
# a limiter fed material that is already at the target reduces less often.
#
# A NEW name, deliberately. `radio` is the handle `control_metadata` and `label_when_off_air` call
# `insert_metadata` on; rebinding it here would move that method onto the compressor's output and
# leave the inserts talking to a source nothing is listening to, so the mount would silently stop
# being labelled. Metadata passes through `compress` untouched, so the label path is otherwise
# unaffected.
bus = compress(attack=1.0, release=80.0, threshold=-1.0, ratio=20.0, knee=0.5, gain=0.0, radio)

# The stream's language, as a `Content-Language` header on the source connection.
#
# That header is the ONLY way Icecast learns it — there is no config option for it on the server
# side, because the server is not the thing that knows — and 2.5 flags a source without one. An
# unset STREAM_LANGUAGE sends no header rather than an empty one, which would be a claim of its own.
stream_language = environment.get("STREAM_LANGUAGE", default="")
source_headers = if stream_language == "" then [] else [("Content-Language", stream_language)] end

# Publishing one mount, so the four of them differ only in the encoder and the path.
#
# Everything else about a mount is the STATION — the same host, the same credential, the same
# name and genre and language header — and writing that out four times is four places for one of
# them to drift. What a caller chooses is what the audio is encoded as and where it is served.
#
# `protocol` is left at its default of "http", which is the PUT method Icecast has wanted since
# 2.4 and 2.5 deprecates SOURCE in favour of.
#
# `send_icy_metadata` is passed explicitly rather than left to be guessed, and that is the point
# of it being a parameter here. The guess is made from the CONTAINER: Icecast's out-of-band ICY
# channel for MP3 and AAC, in-band tags for the Ogg ones. That happens to be right, but it is
# right by accident from the caller's point of view, and the Ogg case is genuinely contested —
# some radio clients read an Ogg comment header once at connect and then freeze on the first
# title they ever saw, while others parse the in-band tags correctly and are broken BY the ICY
# channel. There is no value that suits both, so the one in use is written down at each mount
# rather than inherited, and the day an operator needs the other one it is a visible line to
# change rather than a default to discover.
#
# **It is `send_icy_metadata`, not `icy_metadata`.** They are both parameters of
# `output.icecast` and they are not variants of one another: `icy_metadata` is the LIST of
# metadata FIELDS to put in an update (`["song", "title", "artist", …]`), while
# `send_icy_metadata : bool?` is the switch for whether to send one at all, guessed when null.
# Passing a switch to the field list is a type error rather than a wrong setting, so it costs a
# crash loop rather than a mislabelled mount — which is the better failure, but only once you
# know which of the two you are looking at.
#
# NB: the parameters are `enc`, `src` and `icy_on`, NOT `encoder`, `source` and `icy`. All three
# of those are Liquidsoap's own top-level names, and shadowing one earns `Warning 6: Top-level
# variable X is overridden!`. For `source` that is worse than untidy: the body reads the
# namespace rather than the argument, which is not a type error and so does not fail a check. It
# surfaces a hundred lines away as `Warning 4: Unused variable bus`, meaning the source being
# passed in never reaches the output — a mount fed by nothing, which is silence. Do not rename
# these back.
def publish(~mount, ~icy_on, enc, src) =
  output.icecast(
    enc,
    headers     = source_headers,
    host        = environment.get("ICECAST_HOST", default="icecast"),
    port        = int_of_string(environment.get("ICECAST_PORT", default="8000")),
    password    = environment.get("ICECAST_SOURCE_PASSWORD"),
    mount       = mount,
    send_icy_metadata = icy_on,
    name        = stream_name,
    description = environment.get("STREAM_DESCRIPTION", default=""),
    genre       = environment.get("STREAM_GENRE", default="Talk"),
    url         = environment.get("STREAM_URL", default=""),
    src
  )
end

# 6a) MP3, which is always published.
#
# The compatibility FLOOR rather than a preference, and the reason it has no switch: a Sonos, a
# car head unit and a hardware radio take MP3 or AAC and nothing else, so this is the mount that
# answers whatever somebody points at the station. Every other mount below is an addition beside
# it and none of them replaces it.
#
# MP3 shows in 2.5's dashboard as a generic format, which is inherent to the container rather
# than something to configure away.
publish(
  mount = environment.get("STREAM_MOUNT", default="/live.mp3"),
  icy_on = true,
  %mp3(bitrate=int_of_string(environment.get("STREAM_BITRATE", default="128"))),
  bus
)

# 6b) The optional format mounts.
#
# An EMPTY PATH is how "off" is spelled — the app writes STREAM_MOUNT_OPUS and its siblings from
# `stream.opusEnabled` and friends, deriving each path from STREAM_MOUNT by swapping the
# extension. So a station that never asked for these builds no encoder and opens no connection,
# and each one costs nothing until somebody switches it on.
#
# **The bitrate is a BRANCH, not an interpolation, and it has to be.** `%mp3(bitrate=…)` above
# takes `int_of_string(...)` happily; the encoders below do not. Their bitrate is read when this
# script is PARSED, before any of it runs, so there is no value to hand them at that point and a
# variable there is a syntax error rather than a wrong number. The fixed set each function covers
# is the same set `apps/api/src/modules/stream/stream.settings.ts` offers the console, and the
# two have to be changed together: a figure an operator can choose and this cannot honour would
# silently fall to the default below.
#
# All of them are fed from `bus`, never from `radio`. `bus` is the brick-wall limiter, and a
# mount taken off `radio` would skip it and hand a listener the inter-sample peaks the -1 dBFS
# ceiling exists to leave headroom for.

opus_mount = environment.get("STREAM_MOUNT_OPUS", default="")
if opus_mount != "" then
  # 48 kHz, which Opus mandates: the format has no other rate, so the resample happens either
  # here or nowhere. Here is the right place. The bus stays at 44.1 kHz because the MUSIC is
  # 44.1 kHz, and moving the whole chain to 48 to save this one conversion would resample every
  # ordinary record instead of resampling this one mount.
  def opus_encoder(rate) =
    if rate == 96 then %opus(bitrate=96, samplerate=48000)
    elsif rate == 128 then %opus(bitrate=128, samplerate=48000)
    elsif rate == 192 then %opus(bitrate=192, samplerate=48000)
    elsif rate == 256 then %opus(bitrate=256, samplerate=48000)
    else %opus(bitrate=160, samplerate=48000)
    end
  end

  # In-band tags rather than the ICY channel, which is what Ogg wants and what most players
  # reading an Ogg stream expect. See `publish` for the clients this is wrong for.
  publish(
    mount = opus_mount,
    icy_on = false,
    opus_encoder(int_of_string(environment.get("STREAM_OPUS_BITRATE", default="160"))),
    bus
  )
  log(label="deadair", "publishing Opus on #{opus_mount}")
end

aac_mount = environment.get("STREAM_MOUNT_AAC", default="")
if aac_mount != "" then
  # The format that widens HARDWARE reach, which is the whole reason it is here rather than
  # Opus: a Sonos takes MP3 or AAC, and a player that cannot manage Opus can generally manage
  # this. No resample — AAC is happy at 44.1 kHz, so this mount costs an encoder and nothing else.
  def aac_encoder(rate) =
    if rate == 96 then %fdkaac(bitrate=96)
    elsif rate == 128 then %fdkaac(bitrate=128)
    elsif rate == 160 then %fdkaac(bitrate=160)
    elsif rate == 256 then %fdkaac(bitrate=256)
    elsif rate == 320 then %fdkaac(bitrate=320)
    else %fdkaac(bitrate=192)
    end
  end

  # ADTS, like MP3, has no in-band metadata a source client can write, so the ICY channel IS the
  # metadata path here exactly as it is for the MP3 mount.
  publish(
    mount = aac_mount,
    icy_on = true,
    aac_encoder(int_of_string(environment.get("STREAM_AAC_BITRATE", default="192"))),
    bus
  )
  log(label="deadair", "publishing AAC on #{aac_mount}")
end

flac_mount = environment.get("STREAM_MOUNT_FLAC", default="")
if flac_mount != "" then
  # Ogg-wrapped, not native. `%flac` on its own writes a FLAC FILE, whose header declares a total
  # sample count that a stream does not have; `%ogg(%flac)` is the streamable form and the only
  # one Icecast can serve. No bitrate: FLAC is lossless, so it costs what the material costs,
  # which is roughly 900 kbps and is why this mount gets its own burst size in icecast.xml.
  #
  # Worth having only when the RECORDS are lossless. A FLAC of a decoded lossy file is a perfect
  # copy of a lossy file at seven times the bandwidth, which is a vanity mount on a station whose
  # main source is a lossy provider.
  #
  # No channel or sample rate given: an encoder left alone takes the frame's own, which is the
  # 44.1 kHz stereo this whole chain runs at. Stating them again would be two more literals to
  # keep in step with `settings.frame.*` for no gain.
  flac_encoder = %ogg(%flac)
  publish(mount = flac_mount, icy_on = false, flac_encoder, bus)
  log(label="deadair", "publishing FLAC on #{flac_mount}")
end
