# How far off is the voice-cue clock the further into a record a cue is due?
#
# radio.liq's `on_air_elapsed` used to ADD a fixed tick on every run of its thread, and
# `thread.run` does not fire on the nail, so the counter ran about 3.5% slow: a cue due 6s
# in landed at 6.22s, which is tolerable for a talk-up and is seven seconds late for one
# timed against the end of a three-minute record. It now adds the time that actually passed
# since the last run, measured with `time()`, and counts any step it cannot believe (the
# clock going backwards, or a jump of more than a second) as one tick, so a stepped clock
# still costs a tick rather than a cue.
#
# This runs both counters side by side over one long record and prints, for each of several
# due points, how long had REALLY passed when each counter said it was due. Needs no audio
# analysis: the wall clock is the reference, and nothing here is mixed.
#
# Run it against the pinned image (it takes as long as the record, about three minutes):
#
#   docker run --rm --entrypoint liquidsoap -v "$PWD/stream:/s:ro" savonet/liquidsoap:v2.4.5 /s/voiceclock.check.liq
#
# Each line reads `due=<s> counted=<real s> measured=<real s>`. The measured column should
# sit within a tick (0.1s) of the due point at every distance; the counted one drifts.

settings.init.allow_root := true
settings.log.level := 2

voice_tick = 0.1

# ── BEGIN copied from radio.liq (voice_countup) ──────────────────────────────────
on_air_elapsed = ref(0.)
voice_clock_last = ref(time())

def voice_countup() =
  now = time()
  step = now - voice_clock_last()
  voice_clock_last := now
  on_air_elapsed :=
    on_air_elapsed() + (if step < 0. or step > 1. then voice_tick else step end)
end
# ── END copied from radio.liq ────────────────────────────────────────────────────

# The counter as it was, for comparison.
counted_elapsed = ref(0.)

def counted_countup() =
  counted_elapsed := counted_elapsed() + voice_tick
end

started_at = ref(0.)
due_points = [6., 30., 60., 120., 170.]
counted_hit = ref([])
measured_hit = ref([])

def note_start(_) =
  started_at := time()
  on_air_elapsed := 0.
  counted_elapsed := 0.
end

def check_due() =
  if started_at() > 0. then
    real = time() - started_at()
    list.iter(
      fun (due) ->
        begin
          if
            counted_elapsed() >= due and not list.mem(due, counted_hit())
          then
            counted_hit := list.append(counted_hit(), [due])
            print("counted due=#{due} real=#{real}")
          end
          if
            on_air_elapsed() >= due and not list.mem(due, measured_hit())
          then
            measured_hit := list.append(measured_hit(), [due])
            print("measured due=#{due} real=#{real}")
          end
        end,
      due_points
    )
  end
end

long_record =
  metadata.map(insert_missing=true, (fun (_) -> [("deadair_item", "long")]), amplify(0.3, sine(duration=185., 440.)))
long_record.on_track(synchronous=true, note_start)

thread.run(every=voice_tick, voice_countup)
thread.run(every=voice_tick, counted_countup)
thread.run(every=voice_tick, check_due)

output.dummy(fallible=true, long_record)

thread.run(delay=190., fun () -> shutdown())
