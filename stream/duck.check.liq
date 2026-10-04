# Where does the duck land the bed under the voice?
#
# The bed is one 440 Hz tone at two levels: ten seconds at about -30 LUFS, then ten at about -8. A
# 700 Hz "voice" at about -15 LUFS, where a break lands against the default target and trim, speaks
# for four seconds over each half. Both are below the K-weighting shelf, so a sine's amplitude
# converts to LUFS without a correction. What `duck.check.py` reads back is the bed's level under
# each voice against the voice's own, and whether the bed comes back up after each.
#
# Run with stream/duck.check.py, which writes the tones, runs this in the pinned image and reads the
# result. See stream/README.md.

settings.init.allow_root := true
settings.log.level := 3
settings.frame.audio.samplerate := 44100

# What `radio.default.env` gives the real script.
duck_gain_db = -12.
duck_fade_ms = 300.

bed_queue = request.queue(id="bed")
bed_queue.push(request.create("/w/quiet.wav"))
bed_queue.push(request.create("/w/loud.wav"))
bed = mksafe(bed_queue)

voice = request.queue(id="voice", prefetch=1)
thread.run(delay=3., fun () -> voice.push(request.create("/w/voice.wav")))
thread.run(delay=13., fun () -> voice.push(request.create("/w/voice.wav")))

# ── BEGIN copied from radio.liq ──────────────────────────────────────────────────
def ducked(music_bed, dj_voice) =
  duck_floor = lin_of_dB(duck_gain_db)
  tick_s = 0.025
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
  add(normalize=false, [amplify({gain()}, override=null, music_bed), dj_voice])
end
# ── END copied from radio.liq ────────────────────────────────────────────────────

thread.run(delay=20., fun () -> shutdown())
output.file(%wav(mono), "/w/duck.check.wav", ducked(bed, voice))
