# Renders the station's own crossfade transition over synthetic tracks so the result
# can be MEASURED rather than listened to. Run it with stream/crossfade.check.py; see
# stream/README.md for the command.
#
# It exists because two bugs shipped through code review, a parse check and a careful
# reading of the Liquidsoap sources, and neither would ever have failed loudly: the
# station would have played on, cutting between records exactly as it did before
# crossfades were "added". Ears are not a reliable instrument for "is the overlap 4
# seconds or 0.1" or for "does the pair hold constant power". This is.
#
# Each "record" is a pure sine at a frequency no other one is a harmonic of, so during
# an overlap both are present and each one's amplitude envelope can be recovered
# independently. That turns "does it sound right" into numbers.
#
# Everything between the BEGIN/END markers is COPIED VERBATIM from radio.liq, apart
# from the clearly marked instrumentation.

# `docker compose exec` lands as root and liquidsoap refuses to run as root. Fine for a
# throwaway render in a container; deliberately nowhere near radio.liq.
settings.init.allow_root := true

# Loud enough to see `cross` report what it does with the override. The operator logs
# "Overriding crossfade start and end duration from metadata ..." at info, which is the
# difference between "the override never applied" and "it applied and something else
# ate it".
settings.log.level := 4

# ── BEGIN copied from radio.liq ──────────────────────────────────────────────────
playout_cross_out_key = "liq_cross_end_duration"
playout_cross_in_key = "liq_cross_start_duration"
playout_cross_hard_join = 0.1

def playout_cross_duration(m) =
  float_of_string(default=null, string.trim(m[playout_cross_out_key])) ?? playout_cross_hard_join
end

def playout_transition(a, b) =
  blend = playout_cross_duration(a.metadata)

  # ── INSTRUMENTATION, not in radio.liq ──
  out_id = a.metadata["deadair_item"]
  in_id = b.metadata["deadair_item"]
  raw = a.metadata[playout_cross_out_key]
  rem_a = source.remaining(a.source)
  rem_b = source.remaining(b.source)
  print("XF-TRANSITION out=#{out_id} in=#{in_id} raw=[#{raw}] blend=#{blend} rem_a=#{rem_a} rem_b=#{rem_b}")
  # ── end instrumentation ──
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

# ── END copied from radio.liq ────────────────────────────────────────────────────

def tone_track(name, freq, dur, blend_out, blend_in) =
  s = sine(duration=dur, freq)
  s = amplify(0.3, s)
  # `id=` is deliberately not given the name: `metadata.map`'s id is `string?`, so the
  # same variable there infers as nullable and the metadata tuple stops typechecking.
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

#   a -> b   stamped 4.0   expect a 4 second overlap
#   b -> c   stamped 0.1   expect a hard join, no overlap at all
#   c -> d   stamped 8.0   expect an 8 second overlap
tracks =
  sequence(
    [
      # (blend OUT of me, blend INTO me). Each boundary's number appears twice.
      tone_track("a", 400., 12., "4.0", "0.1"),
      tone_track("b", 1300., 12., "0.1", "4.0"),
      tone_track("c", 2700., 12., "8.0", "0.1"),
      tone_track("d", 5300., 12., "0.1", "8.0")
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

# What the OPERATOR thinks its buffers are, as opposed to what the transition was told.
# `cross` exposes these and the official liquidsoap test for persist_override asserts on
# exactly them. If they stay at 0.1 while the metadata says 4.0, the override is not
# sizing the buffer and no transition function could have saved it.
def report_durations(m) =
  item = m["deadair_item"]
  ending = crossed.end_duration()
  starting = crossed.start_duration()
  print("XF-DURATIONS item=#{item} end=#{ending} start=#{starting}")
end

crossed.on_metadata(synchronous=true, report_durations)

output.file(%wav, fallible=true, "/tmp/crossfade.check.wav", crossed)

# Deterministic stop. The is_ready() watchdog did not fire and the last render ran to
# the timeout writing two minutes of tail. 48s of material, so 55s covers it whether or
# not the blends land.
thread.run(delay=55., fun () -> shutdown())
