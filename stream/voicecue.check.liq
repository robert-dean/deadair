# Does a DJ break land where the app asked for it, once a crossfade is in the graph?
#
# The voice is mixed in ABOVE the cross, so the counter a cue is timed against has to start when the
# listener starts hearing the record. radio.liq zeroes it where the record's metadata leaves the
# cross (`playout_note_heard`), after the queue's own `on_track` was measured on air running up to
# 12s ahead of that. This checks the result lands where it is asked for.
#
# The discriminator: the blend INTO the record under test (4s) and the blend OUT of it
# (8s) are deliberately different, so a lag reading either key is distinguishable from no
# lag at all. Arm a cue 6s into that record and measure when the voice actually starts,
# relative to when the record first became audible:
#
#   6s   right: nothing is added, and nothing needs to be
#   14s  the removed correction is back (6 + 8)
#   10s  a lag equal to the blend INTO the record, which would be a different bug
#
# A short run like this one does not build the lead the station did, so a pass here says the hook
# is in the right place, not that the queue's boundary would have been.
#
# Run with stream/voicecue.check.py. See stream/README.md.

settings.init.allow_root := true
settings.log.level := 3

# ── BEGIN copied from radio.liq ──────────────────────────────────────────────────
playout_cross_out_key = "liq_cross_end_duration"
playout_cross_in_key = "liq_cross_start_duration"
playout_cross_hard_join = 0.1

# Must stay the same shape as radio.liq's: `string.to_float`, never
# `float_of_string(default=null, …) ?? fallback`, which RAISES on an unstamped item rather than
# falling back. These harnesses always stamp both keys, so they never hit it — which is exactly why
# they did not catch it on air.
def playout_cross_duration(m) =
  string.to_float(default=playout_cross_hard_join, string.trim(m[playout_cross_out_key]))
end

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

on_air_item = ref("")
on_air_elapsed = ref(0.)
voice_tick = 0.1
voice_clock_last = ref(time())

def voice_countup() =
  now = time()
  step = now - voice_clock_last()
  voice_clock_last := now
  on_air_elapsed :=
    on_air_elapsed() + (if step < 0. or step > 1. then voice_tick else step end)
end

thread.run(every=voice_tick, voice_countup)

def playout_note_on_air(m) =
  on_air_item := m["deadair_item"]
end

on_air_heard = ref("")

def playout_note_heard(m) =
  item = m["deadair_item"]
  if item != "" and item != on_air_heard() then
    on_air_heard := item
    on_air_elapsed := 0.
  end
end

voice_item = ref("")
voice_at_s = ref(0.)
voice_state = ref("idle")
voice_seen = ref(false)
# ── END copied from radio.liq ────────────────────────────────────────────────────

# Zero, to isolate the cross lag from the duck ramp. radio.liq subtracts duck_fade_now
# here as well, and that half is not in question.
duck_fade_now = ref(0.)

def tone_track(name, freq, dur, blend_out, blend_in) =
  s = amplify(0.3, sine(duration=dur, freq))
  metadata.map(
    insert_missing=true,
    update=false,
    (fun (_) ->
      [
        (playout_cross_out_key, blend_out),
        (playout_cross_in_key, blend_in),
        ("deadair_item", name)
      ]),
    s
  )
end

# b is the record under test: 4s blend in, 8s blend out, so the two candidate lags differ.
tracks =
  sequence(
    [
      tone_track("a", 400., 30., "4.0", "0.1"),
      tone_track("b", 1300., 30., "8.0", "4.0"),
      tone_track("c", 2700., 30., "0.1", "8.0")
    ]
  )

tracks.on_track(synchronous=true, playout_note_on_air)

crossed =
  cross(
    duration=playout_cross_hard_join,
    override_end_duration=playout_cross_out_key,
    override_start_duration=playout_cross_in_key,
    persist_override=true,
    playout_transition,
    tracks
  )

crossed.on_metadata(synchronous=true, playout_note_heard)

# The voice, as a gated tone rather than a request queue. The queue's own resolve time
# is real but tiny for a local file, and it is not what is being measured: this is about
# WHEN the cue fires, which is the arithmetic below.
voice_on = ref(false)
voice_tone = amplify(0.3, sine(7000.))
voice_src = switch(track_sensitive=false, [({voice_on()}, voice_tone)])

# ── BEGIN copied from radio.liq (voice_cue_check) ────────────────────────────────
def voice_cue_check() =
  if voice_state() == "armed" then
    playing = tracks.is_ready() and on_air_heard() == voice_item()
    due = on_air_elapsed() >= max(0., voice_at_s() - duck_fade_now() / 1000.)
    if playing then
      voice_seen := true
      if due then
        voice_on := true
        voice_state := "fired"
      end
    else
      if voice_seen() then voice_state := "missed" end
    end
  end
end

thread.run(every=voice_tick, voice_cue_check)
# ── END copied from radio.liq ────────────────────────────────────────────────────

# Arm it: speak 6 seconds into record b.
voice_item := "b"
voice_at_s := 6.
voice_state := "armed"

output.file(%wav, fallible=true, "/tmp/voicecue.check.wav", add(normalize=false, [crossed, voice_src]))

thread.run(delay=75., fun () -> shutdown())
