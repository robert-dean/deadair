# Where does the duck land the bed under the voice?
#
# The bed is one 440 Hz tone at two levels: ten seconds at about -30 LUFS, then twelve at about -8. A
# 700 Hz "voice" at about -15 LUFS, where a break lands against the default target and trim, speaks
# for four seconds three times: over the quiet half, across the step from quiet to loud (a record
# kicking in under a talk-up), and over the loud half. Both tones are below the K-weighting shelf,
# so a sine's amplitude converts to LUFS without a correction. What `duck.check.py` reads back is
# the bed's level under each voice against the voice's own, and whether the bed comes back up after.
# The last break is stamped with its own bed level, as the app stamps a cue; the first two are not,
# and duck to the `DUCK_BED_LUFS` fallback.
#
# Run with stream/duck.check.py, which writes the tones, runs this in the pinned image and reads the
# result. See stream/README.md.

settings.init.allow_root := true
settings.log.level := 3
settings.frame.audio.samplerate := 44100

# What `radio.default.env` gives the real script.
duck_bed_lufs = -25.
duck_gain_db = -18.
duck_min_db = -3.
duck_fade_ms = 300.

bed_queue = request.queue(id="bed")
bed_queue.push(request.create("/w/quiet.wav"))
bed_queue.push(request.create("/w/loud.wav"))
bed = mksafe(bed_queue)

voice = request.queue(id="voice", prefetch=1)
thread.run(delay=3., fun () -> voice.push(request.create("/w/voice.wav")))
thread.run(delay=8., fun () -> voice.push(request.create("/w/voice.wav")))
# Stamped, as the app stamps every cue it arms, and two above the fallback so the reading can
# tell which of the two the duck used.
thread.run(delay=15., fun () -> voice.push(request.create('annotate:deadair_duck_bed_lufs="-23":/w/voice.wav')))

# ── BEGIN copied from radio.liq ──────────────────────────────────────────────────
duck_attack_db_per_s = 30.
duck_release_db_per_s = 3.

duck_bed_now = ref(duck_bed_lufs)
duck_bed_fresh = ref(false)
voice.on_track(
  synchronous=true,
  fun (m) ->
    begin
      duck_bed_now := string.to_float(default=duck_bed_lufs, string.trim(m["deadair_duck_bed_lufs"]))
      duck_bed_fresh := true
    end
)

def ducked(music_bed, dj_voice) =
  metered = lufs(window=3., music_bed)
  tick_s = 0.025
  attack_step_db = duck_attack_db_per_s * tick_s
  release_step_db = duck_release_db_per_s * tick_s
  depth_db = ref(duck_min_db)
  gain = ref(1.)
  thread.run(
    every=tick_s,
    fun () ->
      begin
        measured = max(metered.lufs(), metered.lufs_momentary())
        wanted =
          if not (measured >= -50.) then duck_min_db
          else max(duck_gain_db, min(duck_min_db, duck_bed_now() - measured))
          end
        speaking = dj_voice.is_ready()
        depth_db :=
          if not speaking or duck_bed_fresh() then wanted
          elsif depth_db() < wanted then min(wanted, depth_db() + release_step_db)
          else max(wanted, depth_db() - attack_step_db)
          end
        duck_bed_fresh := false
        duck_floor = lin_of_dB(depth_db())
        target = if speaking then duck_floor else 1. end
        current = gain()
        step = (1. - min(current, duck_floor)) * (tick_s * 1000. / duck_fade_ms)
        gain :=
          if current < target then min(target, current + step)
          else max(target, current - step)
          end
      end
  )
  add(normalize=false, [amplify({gain()}, override=null, metered), dj_voice])
end
# ── END copied from radio.liq ────────────────────────────────────────────────────

thread.run(delay=22., fun () -> shutdown())
output.file(%wav(mono), "/w/duck.check.wav", ducked(bed, voice))
