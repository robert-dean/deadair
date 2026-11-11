# Does a stand-down leave anything behind for the next listener?
#
# A record (440 Hz) airs under the lease through a twelve-second cross, the longest blend the app
# stamps, and a talk-over (880 Hz) starts over it. At sixteen and a half seconds the station stands
# down exactly as `/control/offair` does it. At thirty the next listener arrives: the lease is taken
# again and a new record (660 Hz) is pushed. What `offair.check.py` reads back, from thirty on:
#
#   the new record, and neither the old record nor the old talk-over in front of it
#   only the new record's title reaching the mount, not the old two on the way
#
# With OFFAIR_DRAIN=0 the drain is left out, which is how the station was before it: the check
# expects the old record's tail on the return then, so it is known to be able to see the fault.
#
# Run with stream/offair.check.py, which writes the tones, runs this in the pinned image twice and
# reads the result. See stream/README.md.

settings.init.allow_root := true
settings.log.level := 2
settings.frame.audio.samplerate := 44100

def env_float(name, default) =
  string.to_float(default=default, environment.get(default="", name))
end

started = time()
def elapsed() =
  time() - started
end

# ── HARNESS, not in radio.liq ──
# The queue, the cross and the voice, without the levelling between them. The cross is fixed at the
# longest blend rather than read off the record's metadata.
playout_queue = request.queue(id="playout")
playout_bed = cross(duration=12., fun (a, b) -> add(normalize=false, [fade.in(duration=12., b.source), fade.out(duration=12., a.source)]), playout_queue)
music = mksafe(single("/w/bed.wav"))
bed = fallback(track_sensitive=false, [playout_bed, music])
voice = request.queue(id="voice", prefetch=1)
voice_bus = voice
programme = fallback(track_sensitive=false, [voice_bus, bed])

lease_left = ref(0.)
lease_tick = 0.5
thread.run(every=lease_tick, fun () -> lease_left := max(0., lease_left() - lease_tick))
def driving() =
  lease_left() > 0.
end
warmed = ref(false)
def on_programme() =
  driving() and (warmed() or playout_queue.is_ready())
end
thread.run(every=lease_tick, fun () -> warmed := driving() and (warmed() or playout_queue.is_ready()))

def drop_queued() =
  q = list.rev(playout_queue.queue())
  list.iter(fun (r) -> playout_queue.remove(r), q)
  list.iter(fun (r) -> request.destroy(r), q)
end
drain_on = env_float("OFFAIR_DRAIN", 1.) > 0.
# ── end harness ──

# ── BEGIN copied from radio.liq ──────────────────────────────────────────────────
playout_drain_s = 15.
playout_drain_left = ref(0.)
thread.run(every=lease_tick, fun () -> playout_drain_left := max(0., playout_drain_left() - lease_tick))

voice_stand_down = ref(fun () -> ())

voice_stand_down := fun () -> begin
  q = list.rev(voice.queue())
  list.iter(fun (r) -> voice.remove(r), q)
  list.iter(fun (r) -> request.destroy(r), q)
  voice.skip()
end

def playout_draining() =
  playout_drain_left() > 0. and not driving() and (playout_bed.is_ready() or voice_bus.is_ready())
end
playout_drain_sink = amplify(0., override=null, source.drop.metadata(add(normalize=false, [playout_bed, voice_bus])))

gated =
  fallback(
    track_sensitive=false,
    [switch(track_sensitive=false, [({on_programme()}, programme), ({playout_draining()}, playout_drain_sink)]), blank()]
  )
# ── END copied from radio.liq ────────────────────────────────────────────────────

# `control_offair`'s body, less the cue bookkeeping, with the drain behind the switch.
def stand_down() =
  lease_left := 0.
  drop_queued()
  playout_queue.skip()
  stand_down_voice = voice_stand_down()
  stand_down_voice()
  if drain_on then
    playout_drain_left := playout_drain_s
  end
end

gated.on_metadata(synchronous=true, fun (m) -> print("label #{elapsed()} #{m['title']}"))

# The lease is renewed as the app renews it, every two seconds, while the station wants the mount.
thread.run(every=2., fun () -> if elapsed() < 16. or elapsed() > 30. then lease_left := 6. end)
thread.run(delay=0.5, fun () -> playout_queue.push(request.create('annotate:title="old record":/w/old.wav')))
thread.run(delay=12., fun () -> voice.push(request.create('annotate:title="old talk-over":/w/voice.wav')))
thread.run(delay=16.5, stand_down)
thread.run(delay=30., fun () -> begin
  playout_queue.push(request.create('annotate:title="new record":/w/new.wav'))
  lease_left := 6.
end)
thread.run(delay=40., fun () -> shutdown())
output.file(%wav(mono), "/w/offair.check.wav", fallible=false, gated)
