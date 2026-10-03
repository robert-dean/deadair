# Does a cut asked for with a fade go out on a ramp, and does the next record start at full level?
#
# Two tones in a queue: the first ten seconds long at 440 Hz, the second at 1300 Hz. One second in,
# the first is faded over two seconds and cut, exactly as `control_skip` does with `x-fade-ms`. What
# `fadeskip.check.py` reads back:
#
#   the first tone falls steadily from full to nothing between one and three seconds
#   nothing of it is heard at full level after the cut (an earlier version put the level back
#     before the skip had landed and played a fifth of a second of the cut record at full volume)
#   the second tone starts at full level, not faded
#
# Run with stream/fadeskip.check.py, which writes the tones, runs this in the pinned image and
# reads the result. See stream/README.md.

settings.init.allow_root := true
settings.log.level := 3
settings.frame.audio.samplerate := 44100

playout_queue = request.queue(id="playout")
playout_queue.push(request.create("/w/first.wav"))
playout_queue.push(request.create("/w/second.wav"))

# ── BEGIN copied from radio.liq ──────────────────────────────────────────────────
playout_fade_gain = ref(1.)
playout_queue.on_track(synchronous=true, fun (_) -> playout_fade_gain := 1.)
playout_bed = amplify(override=null, {playout_fade_gain()}, playout_queue)

playout_fade_step = 0.05

def playout_fade_skip(item, ms) =
  steps = max(1, int_of_float(float_of_int(ms) / 1000. / playout_fade_step))
  done = ref(0)
  def step() =
    done := done() + 1
    if not playout_queue.is_ready() or item != "first" then
      playout_fade_gain := 1.
      (-1.)
    elsif done() >= steps then
      playout_fade_gain := 0.
      playout_queue.skip()
      (-1.)
    else
      playout_fade_gain := 1. - float_of_int(done()) / float_of_int(steps)
      playout_fade_step
    end
  end
  thread.run.recurrent(fast=true, on_error=fun (_) -> begin playout_fade_gain := 1. (-1.) end, step)
end
# ── END copied from radio.liq ────────────────────────────────────────────────────

thread.run(delay=1., fun () -> playout_fade_skip("first", 2000))
thread.run(delay=6., fun () -> shutdown())
output.file(%wav(mono), "/w/fadeskip.check.wav", mksafe(playout_bed))
