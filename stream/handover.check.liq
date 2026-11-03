# Renders the filtered handover in `playout_transition` beside the plain fade, so what it did to each
# band of each record can be measured. Run it with stream/handover.check.py; see stream/README.md.
#
# Each "record" is a file of three pure tones, one bass, one mid and one top, so each can be read off
# its own frequency. HANDOVER_MODE=filtered stamps every record the way the app would, and
# HANDOVER_MODE=plain leaves the stamp off, so the two renders can be compared sample by sample:
# outside the overlaps they must be the same audio.
#
# Everything between the BEGIN/END markers is COPIED VERBATIM from radio.liq.

settings.init.allow_root := true
settings.log.level := 3

mode = environment.get("HANDOVER_MODE", default="plain")

# ── BEGIN copied from radio.liq ──────────────────────────────────────────────────
playout_cross_out_key = "liq_cross_end_duration"
playout_cross_in_key = "liq_cross_start_duration"
playout_cross_hard_join = 0.1

def playout_cross_duration(m) =
  string.to_float(default=playout_cross_hard_join, string.trim(m[playout_cross_out_key]))
end

# The filtered handover: the rung above the plain fade, for a record the app stamps it on. The outgoing
# record thins out instead of only getting quieter, and the basses change hands instead of summing.
# Two basslines through a long overlap are the one thing a level-only fade cannot fix. Nothing about a
# beat or a tempo is read, so it needs nothing the sidecar does not measure.
#
# Measured by stream/handover.check.py, and each of these is silently wrong rather than loud if missed:
#
#   1. `filter`, NOT `filter.iir.butterworth.*`. At order 4 the Butterworth saturates a plain record at
#      full scale, at both corners tried (200 Hz and 2 kHz).
#   2. `q=1`, because `filter`'s q is also its passband gain: 0.707 takes 3 dB off everything it passes.
#   3. `wetness`, and not a dry and a filtered branch summed. It is a linear mix, so at 0 the signal is
#      the dry record bit for bit, and the filter's phase is not a step when the overlap ends. Outside
#      the overlap this differs from the plain fade by nothing at all.
#   4. A getter moves once a frame, so a ramp is a staircase and its length is the size of the steps.
#      A bass ramp of 0.15s stepped at -42 dB above the tones it moved, and 0.6s at -51 dB, where the
#      plain fade's own are -56 dB. Two basses are level for 0.07s of it.
#   5. `source.time` and not `time()`: the clock's own count of what was played, so the moves stay on
#      the fades however late a frame is.
playout_handover_key = "deadair_handover"
# Below this every bassline sits, and the outgoing record's sweep ends here too.
playout_handover_bass_hz = 200.
# Below this length a blend stays the plain fade. The sweep would be a dive and the swap most of the
# overlap, and it is a judgement, not a measurement: the steps rise as a blend shortens (-48 dB at 3s,
# -39 dB at 1s), and on real records nothing could be heard at 4s where it could at 8s.
playout_handover_shortest_s = 3.
# How far through the overlap the basses change hands, and how long that takes.
playout_handover_bass_at = 0.4
playout_handover_bass_ramp_s = 0.6
# The sweep runs down from here, exponentially. `filter` asks for less than a quarter of the sampling
# rate. It comes in over the first tenth of the overlap, so the record is dry until then.
playout_handover_sweep_from_hz = 8000.
playout_handover_sweep_in = 0.1

def playout_handover_unit(x) =
  min(1., max(0., x))
end

# `s` between dry (gain 0) and high-passed (gain 1). Twice, for 24 dB an octave.
def playout_handover_without_bass(gain, s) =
  s = filter(freq=playout_handover_bass_hz, q=1., mode="high", wetness=gain, s)
  filter(freq=playout_handover_bass_hz, q=1., mode="high", wetness=gain, s)
end

def playout_handover(blend, a, b) =
  started = source.time(a)
  def through() =
    playout_handover_unit((source.time(a) - started) / blend)
  end
  def bass_moved() =
    playout_handover_unit((through() - playout_handover_bass_at) * blend / playout_handover_bass_ramp_s)
  end
  outgoing =
    filter(
      freq={playout_handover_sweep_from_hz * pow(playout_handover_bass_hz / playout_handover_sweep_from_hz, through())},
      q=1.,
      mode="low",
      wetness={playout_handover_unit(through() / playout_handover_sweep_in)},
      playout_handover_without_bass(bass_moved, a)
    )
  add(
    normalize=false,
    [
      fade.in(type="log", curve=6.4, duration=blend, playout_handover_without_bass({1. - bass_moved()}, b)),
      fade.out(type="log", curve=6.4, duration=blend, outgoing)
    ]
  )
end

# What happens during the overlap.
#
# Equal-power unless the outgoing record is stamped for the handover above, which is the plain rung.
# The rungs above it want the beat layer. See
# [crossfades](https://github.com/robert-dean/deadair/discussions/11).
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
  # Never fade a record into speech, whatever blend the OUTGOING item was stamped with. That
  # stamp is decided before a break can be injected behind it: the app stamps `a`'s blend at
  # commit time, off what was next at that moment, and a break landed later at `committedThrough`
  # takes that slot without the stamp ever being revisited. Measured on 2026-09-10: 65% of
  # adjacent record-then-speech pairs would blend under the old rule, median 2.8 s of a record
  # fading under a voice that was never in the mix when the blend was decided.
  if
    b.metadata["deadair_speech"] == "1"
  then
    sequence([a.source, b.source])
  elsif
    blend <= playout_cross_hard_join
  then
    sequence([a.source, b.source])
  elsif
    a.metadata[playout_handover_key] == "1" and blend >= playout_handover_shortest_s
  then
    playout_handover(blend, a.source, b.source)
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

# ── END copied from radio.liq ────────────────────────────────────────────────────

records_dir = environment.get("HANDOVER_DIR", default="/w")

def tones(name, blend_out, blend_in) =
  metadata.map(
    insert_missing=true,
    update=false,
    (
      fun (_) ->
        [
          (playout_cross_out_key, blend_out),
          (playout_cross_in_key, blend_in),
          (playout_handover_key, if mode == "filtered" then "1" else "0" end),
          ("deadair_item", name)
        ]
    ),
    once(single(path.concat(records_dir, "#{name}.wav")))
  )
end

# Files, written by handover.check.py, and not `add` over `sine`: `add` drops the end-of-track mark, so
# `cross` never sees a boundary and the render is the records played end to end.
#
# Each line's first stamp is the boundary out of it, and the next line's second stamp the same boundary.
first_blend = environment.get("HANDOVER_FIRST_BLEND", default="4.0")

tracks =
  sequence(
    [
      tones("a", first_blend, "0.1"),
      tones("b", "8.0", first_blend),
      tones("c", "0.1", "8.0"),
      tones("d", "6.0", "0.1"),
      tones("e", "0.1", "6.0")
    ]
  )

crossed =
  cross(
    duration=playout_cross_hard_join,
    override_end_duration=playout_cross_out_key,
    override_start_duration=playout_cross_in_key,
    persist_override=true,
    playout_transition,
    tracks
  )

output.file(%wav, fallible=true, on_stop=shutdown, environment.get("HANDOVER_OUT", default="/tmp/handover.wav"), crossed)
