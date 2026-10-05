# Does the voice leave the compressor at the level the app aimed it at?
#
# The input is speech already levelled to an aim, exactly as the app's `liq_amplify` stamp levels a
# segment, and it goes through the voice compressor both chains share. `voice.check.py` runs this
# twice, at two aims, and reads back where the voice came out and how hard its peaks were. The aim
# and the stamp arrive as environment variables because they are the two things that differ between
# the runs; the chain itself is the one copied below.
#
# It also renders the chain this replaced, a FIXED -18 threshold with no makeup, so the difference
# is on the same page as the result.
#
# Run with stream/voice.check.py. See stream/README.md.

settings.init.allow_root := true
settings.log.level := 2
settings.frame.audio.samplerate := 22050

aim = float_of_string(environment.get("AIM"))
stamp_db = float_of_string(environment.get("STAMP_DB"))

def levelled() =
  amplify(override=null, lin_of_dB(stamp_db), once(single("/w/speech.wav")))
end

# ── BEGIN copied from radio.liq ──────────────────────────────────────────────────
voice_comp_makeup_db = 2.75
voice_aim_lufs = ref(aim)
def voice_compressor(s) =
  compress(attack=5.0, release=120.0, threshold={voice_aim_lufs()}, ratio=4.0, knee=2.0, gain=voice_comp_makeup_db, s)
end
# ── END copied from radio.liq ────────────────────────────────────────────────────

def render(name, s) =
  o = output.file(%wav(stereo), fallible=true, "/w/#{name}.wav", s)
  c = clock.create(sync="none")
  c.unify(o.clock)
end

render("chain", voice_compressor(levelled()))
render("fixed", compress(attack=5.0, release=120.0, threshold=-18.0, ratio=4.0, knee=2.0, gain=0.0, levelled()))
thread.run(delay=30., fun () -> shutdown())
