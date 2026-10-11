# Does a fresh lease wait on silence for its first record, rather than airing the bed?
#
# The bed is a 1300 Hz tone under the programme, standing in for the station ident, and the record
# is a 440 Hz tone. The lease is taken one second in, and the record is pushed at three, standing in
# for a download that takes two seconds. What `warmup.check.py` reads back:
#
#   nothing at all between one and three seconds: the lease is held and the mount is on silence
#   the record from three seconds, and never the bed in front of it
#   no gap reported while warming (the app would log the bed as having aired instead of the order)
#
# With WARMUP_PUSH_AT set past the allowance instead, the record arrives too late and the warm-up
# gives up: the bed airs once PLAYOUT_WARMUP_S has gone, and THAT is reported as a gap, as before.
#
# Run with stream/warmup.check.py, which writes the tones, runs this in the pinned image and reads
# the result. See stream/README.md.

settings.init.allow_root := true
settings.log.level := 2
settings.frame.audio.samplerate := 44100

def env_float(name, default) =
  string.to_float(default=default, environment.get(default="", name))
end

playout_queue = request.queue(id="playout")
programme = fallback(track_sensitive=false, [playout_queue, mksafe(single("/w/bed.wav"))])

# ── HARNESS, not in radio.liq ──
# The lease without its countdown: the harness takes it once and holds it.
lease_left = ref(0.)
lease_tick = 0.5
def driving() =
  lease_left() > 0.
end
# ── end harness ──

# ── BEGIN copied from radio.liq ──────────────────────────────────────────────────
playout_warmup = max(0., env_float("PLAYOUT_WARMUP_S", 15.))
warmed = ref(false)
warming_for = ref(0.)

def on_programme() =
  driving() and (warmed() or playout_queue.is_ready())
end

def warming() =
  driving() and not warmed() and not playout_queue.is_ready()
end

def warm_up_step() =
  if not driving() then
    warmed := false
    warming_for := 0.
  elsif not warmed() then
    if playout_queue.is_ready() or warming_for() >= playout_warmup then
      warmed := true
    else
      warming_for := warming_for() + lease_tick
    end
  end
end

radio = fallback(track_sensitive=false, [switch(track_sensitive=false, [({on_programme()}, programme)]), blank()])
# ── END copied from radio.liq ────────────────────────────────────────────────────

# The starve watch's own condition, printed rather than posted.
def watch_starve() =
  warm_up_step()
  gap = driving() and warmed() and not playout_queue.is_ready()
  print("tick warming=#{warming()} gap=#{gap}")
end
thread.run(every=lease_tick, watch_starve)

push_at = env_float("WARMUP_PUSH_AT", 3.)
thread.run(delay=1., fun () -> lease_left := 3600.)
thread.run(delay=push_at, fun () -> playout_queue.push(request.create("/w/record.wav")))
thread.run(delay=7., fun () -> shutdown())
output.file(%wav(mono), "/w/warmup.check.wav", radio)
