# Does a record cut short for a hard marker fade out and end exactly on its cut, and does the next item
# start at full level?
#
# Three tones in a queue, stamped as the app stamps them (see CUT_KEY and `cutOf` in annotate.ts). A
# one-second lead-in so the cut is not the first track; then ten seconds at 440 Hz cut at six
# (`liq_cue_out`), with the boundary stamped three seconds on both sides; then 1300 Hz. What
# `cut.check.py` reads back:
#
#   the cut tone is at full level until its fade begins, three seconds before the cut
#   it falls at every step of the fade
#   nothing of it is heard after the cut, which is seven seconds into the render
#   the next tone starts at full level on the cut, not faded in
#
# Run with stream/cut.check.py, which writes the tones, runs this in the pinned image and reads the
# result. See stream/README.md.

settings.init.allow_root := true
settings.log.level := 3
settings.frame.audio.samplerate := 44100

playout_queue = request.queue(id="playout")
playout_queue.push(request.create('annotate:liq_cue_out="1",liq_cross_end_duration="0.1",liq_cross_start_duration="0.1":/w/lead.wav'))
playout_queue.push(request.create('annotate:liq_cue_out="6",liq_cross_end_duration="3",liq_cross_start_duration="0.1",deadair_cut="1":/w/first.wav'))
playout_queue.push(request.create('annotate:liq_cross_start_duration="3",liq_cross_end_duration="0.1":/w/second.wav'))

# ── BEGIN copied from radio.liq (the cut branch of `playout_transition`, and `cross` as it is called) ──
playout_cross_out_key = "liq_cross_end_duration"
playout_cross_in_key = "liq_cross_start_duration"
playout_cross_hard_join = 0.1

def playout_cross_duration(m) =
  string.to_float(default=playout_cross_hard_join, string.trim(m[playout_cross_out_key]))
end

def playout_transition(a, b) =
  blend = playout_cross_duration(a.metadata)
  cut = a.metadata["deadair_cut"] == "1"
  if
    cut
  then
    log(label="deadair", "cut: faded out over #{blend}s")
    faded = (fade.out(type="log", curve=6.4, duration=blend, a.source) : source)
    sequence([faded, b.source])
  else
    sequence([a.source, b.source])
  end
end

playout_bed =
  cross(
    duration=playout_cross_hard_join,
    override_end_duration=playout_cross_out_key,
    override_start_duration=playout_cross_in_key,
    persist_override=true,
    playout_transition,
    playout_queue
  )
# ── END copied from radio.liq ────────────────────────────────────────────────────

thread.run(delay=11., fun () -> shutdown())
output.file(%wav(mono), "/w/cut.check.wav", mksafe(playout_bed))
