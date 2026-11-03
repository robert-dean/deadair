# A spike, not the station: can Liquidsoap 2.4.5 do the filtered handover in a `cross` transition?
# Discussion #11 left that unverified. Run it with stream/handover.check.py.
#
# Each "record" is three pure tones, one bass, one mid and one top, so what each move did to each band
# of each record can be read off its own frequency. The last one is quiet, because the duck has to
# answer to the incoming record's level. HANDOVER_MODE=plain renders radio.liq's transition
# as it stands, and HANDOVER_MODE=filtered the three moves, so the two renders can be compared sample
# by sample: outside the overlaps they must be the same audio.

settings.init.allow_root := true
settings.log.level := 3

mode = environment.get("HANDOVER_MODE", default="plain")

playout_cross_out_key = "liq_cross_end_duration"
playout_cross_in_key = "liq_cross_start_duration"
playout_cross_hard_join = 0.1

def playout_cross_duration(m) =
  string.to_float(default=playout_cross_hard_join, string.trim(m[playout_cross_out_key]))
end

# Below this every record's bass tone sits, and above it every mid tone.
handover_bass_hz = 200.
# How far through the overlap the bass changes hands, over this ramp. A getter moves once a frame, so
# the ramp is a staircase and its length is the size of the steps: at 0.15s they reach -42 dB above
# every tone, and at 0.6s -51 dB, where the plain fade's own are -56 dB. Two basses are level for 0.07s.
handover_bass_at = 0.4
handover_bass_ramp_s = 0.6
# The outgoing record's low-pass runs between these, exponentially. `filter` asks for a frequency
# below a quarter of the sampling rate. It comes in over the first tenth of the overlap, so the record
# is the dry signal until then.
handover_sweep_from_hz = 8000.
handover_sweep_to_hz = 200.
handover_sweep_in = 0.1
# The mid-band duck: a notch mixed in by `wetness`, so 0.5 is 6 dB off the centre frequency. Its depth
# follows the incoming record, reaching the most at this RMS, about where mastered music sits.
handover_duck_hz = 1000.
handover_duck_most = 0.5
handover_duck_full_rms = 0.2

moves = string.split(separator=",", environment.get("HANDOVER_MOVES", default="bass,sweep,duck"))

def move(name) =
  list.mem(name, moves)
end

# `filter`'s q is also its passband gain, so anything but 1 is a level change the moment `wetness` moves.
# Measured: q=0.707 passes the bass of the very record it is not filtering 3 dB down.
handover_q = 1.

def clamp01(x) =
  min(1., max(0., x))
end

# `s` between dry (gain 0) and high-passed (gain 1), by `wetness`, so the signal is the dry record bit
# for bit at gain 0 and the filter's phase is not a step in the incoming record when the overlap ends.
# Twice, for 24 dB an octave. `filter`, and NOT `filter.iir.butterworth.high`: see handover.check.py.
def without_bass(gain, s) =
  s = filter(freq=handover_bass_hz, q=handover_q, mode="high", wetness=gain, s)
  filter(freq=handover_bass_hz, q=handover_q, mode="high", wetness=gain, s)
end

def filtered_handover(blend, a, b) =
  # The clock's own time, in samples played rather than on the wall, so the moves stay on the fades
  # however late a frame is.
  started = source.time(a)
  def through() =
    clamp01((source.time(a) - started) / blend)
  end
  def bass_moved() =
    clamp01((through() - handover_bass_at) * blend / handover_bass_ramp_s)
  end

  incoming = if move("bass") then without_bass({1. - bass_moved()}, b) else b end
  incoming = rms(duration=0.2, fade.in(type="log", curve=6.4, duration=blend, incoming))

  outgoing = if move("bass") then without_bass(bass_moved, a) else a end
  outgoing =
    if
      move("sweep")
    then
      filter(
        freq={handover_sweep_from_hz * pow(handover_sweep_to_hz / handover_sweep_from_hz, through())},
        q=handover_q,
        mode="low",
        wetness={clamp01(through() / handover_sweep_in)},
        outgoing
      )
    else
      outgoing
    end
  outgoing =
    if
      move("duck")
    then
      filter(
        freq=handover_duck_hz,
        q=handover_q,
        mode="notch",
        wetness={min(handover_duck_most, incoming.rms() / handover_duck_full_rms * handover_duck_most)},
        outgoing
      )
    else
      outgoing
    end
  outgoing = fade.out(type="log", curve=6.4, duration=blend, outgoing)

  add(normalize=false, [incoming, outgoing])
end

def plain_handover(blend, a, b) =
  add(
    normalize=false,
    [
      fade.in(type="log", curve=6.4, duration=blend, b),
      fade.out(type="log", curve=6.4, duration=blend, a)
    ]
  )
end

def handover_transition(a, b) =
  blend = playout_cross_duration(a.metadata)
  print("HANDOVER mode=#{mode} blend=#{blend} rem_a=#{source.remaining(a.source)} rem_b=#{source.remaining(b.source)}")
  if
    blend <= playout_cross_hard_join
  then
    sequence([a.source, b.source])
  elsif
    mode == "filtered"
  then
    filtered_handover(blend, a.source, b.source)
  else
    plain_handover(blend, a.source, b.source)
  end
end

records_dir = environment.get("HANDOVER_DIR", default="/w")

def tones(name, blend_out, blend_in) =
  metadata.map(
    insert_missing=true,
    update=false,
    (fun (_) -> [(playout_cross_out_key, blend_out), (playout_cross_in_key, blend_in), ("deadair_item", name)]),
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
    handover_transition,
    tracks
  )

output.file(%wav, fallible=true, on_stop=shutdown, environment.get("HANDOVER_OUT", default="/tmp/handover.wav"), crossed)
